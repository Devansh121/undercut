import { padAxis, padButton, parsePadControl, type ControlId } from '../controls';
import { applyAxisCurve, type GamepadShaping } from '../shaping';
import {
  MAX_PENDING_PRESSES,
  type ActivityClock,
  type DeviceChange,
  type DeviceSource,
} from './source';

/** The parts of a browser `Gamepad` the input layer reads. A real `Gamepad` satisfies it. */
export interface GamepadSnapshot {
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

/** Returns the current pads, as `navigator.getGamepads()` does (holes are null). */
export type GamepadReader = () => readonly (GamepadSnapshot | null | undefined)[];

/** Force feedback output. Implementations play dual-rumble where the browser allows it. */
export interface RumblePort {
  /** Magnitudes in [0, 1], duration in seconds. Silently does nothing if the pad cannot rumble. */
  play(padIndex: number, strong: number, weak: number, duration: number): void;
  stop(padIndex: number): void;
}

/** A button counts as pressed above this travel (also for analog triggers). */
const BUTTON_PRESS = 0.5;
/** A stick direction counts as pressed past this deflection, released below the second. */
const AXIS_PRESS = 0.5;
const AXIS_RELEASE = 0.35;

interface PadState {
  id: string;
  buttons: boolean[];
  /** Per axis: -1 or 1 while that direction is pressed, else 0. */
  axes: number[];
  lastActivity: number;
  /**
   * Controls held through a focus loss (or while unfocused). They read 0 and cannot press
   * until they have been let go, so nothing held before alt-tab acts after it.
   */
  blocked: Set<ControlId>;
}

interface PendingPress {
  pad: number;
  control: ControlId;
}

/** Gamepads, polled once per sample. The most recently used pad drives the car. */
export class GamepadSource implements DeviceSource {
  readonly kind = 'gamepad' as const;
  lastActivity = 0;
  private readonly states = new Map<number, PadState>();
  private current: GamepadSnapshot | null = null;
  /** Presses since the last drain, with the pad they came from. */
  private pending: PendingPress[] = [];
  private readonly drained: ControlId[] = [];
  private suspended = false;
  private latchHeld = false;
  private changes: DeviceChange[] = [];
  private drainedChanges: DeviceChange[] = [];

  constructor(
    private readonly read: GamepadReader,
    private readonly clock: ActivityClock,
    private readonly shaping: () => GamepadShaping,
    private readonly rumblePort: RumblePort | null = null,
  ) {}

  get connected(): boolean {
    return this.current !== null;
  }

  /** The pad currently read, or null. */
  get activePad(): GamepadSnapshot | null {
    return this.current;
  }

  /** Ids of every connected pad. */
  connectedIds(): string[] {
    return [...this.states.values()].map((s) => s.id);
  }

  poll(): void {
    let pads: readonly (GamepadSnapshot | null | undefined)[];
    try {
      pads = this.read();
    } catch {
      pads = [];
    }
    const seen = new Set<number>();
    let best: GamepadSnapshot | null = null;
    let bestActivity = -1;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      seen.add(pad.index);
      let state = this.states.get(pad.index);
      if (state && state.id !== pad.id) {
        this.changes.push({ type: 'disconnected', device: 'gamepad', id: state.id });
        state = undefined;
      }
      if (!state) {
        state = { id: pad.id, buttons: [], axes: [], lastActivity: 0, blocked: new Set() };
        this.states.set(pad.index, state);
        this.changes.push({ type: 'connected', device: 'gamepad', id: pad.id });
      }
      if (this.suspended || this.latchHeld) this.block(pad, state);
      else this.unblock(pad, state);
      // Browsers reveal a pad only after a button press, so whatever is down on the first
      // poll counts as a press: it is the input that made the pad appear.
      this.edges(pad, state, pad.index);
      if (state.lastActivity > bestActivity) {
        best = pad;
        bestActivity = state.lastActivity;
      }
    }
    for (const [index, state] of this.states) {
      if (!seen.has(index)) {
        this.states.delete(index);
        this.changes.push({ type: 'disconnected', device: 'gamepad', id: state.id });
      }
    }
    this.current = best;
    if (!this.suspended) this.latchHeld = false;
    // Activity belongs to pads, not to the source: a removed pad takes its stamp with it.
    let activity = 0;
    for (const state of this.states.values()) activity = Math.max(activity, state.lastActivity);
    this.lastActivity = activity;
  }

  /** Stop reading the pads (page unfocused or hidden); everything held must be let go after. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.releaseAll();
  }

  /** Whether a control on this pad is engaged at all (past its dead zone, or reported pressed). */
  private engaged(pad: GamepadSnapshot, control: ControlId): boolean {
    const parsed = parsePadControl(control);
    if (!parsed) return false;
    if (parsed.kind === 'button') {
      const b = pad.buttons[parsed.index];
      return !!b && (b.pressed || this.shapedLevel(pad, control) > 0);
    }
    return this.shapedLevel(pad, control) > 0;
  }

  private block(pad: GamepadSnapshot, state: PadState): void {
    for (let i = 0; i < pad.buttons.length; i++) {
      const control = padButton(i);
      if (this.engaged(pad, control)) state.blocked.add(control);
    }
    for (let i = 0; i < pad.axes.length; i++) {
      for (const direction of [-1, 1] as const) {
        const control = padAxis(i, direction);
        if (this.engaged(pad, control)) state.blocked.add(control);
      }
    }
  }

  private unblock(pad: GamepadSnapshot, state: PadState): void {
    for (const control of state.blocked) {
      if (!this.engaged(pad, control)) state.blocked.delete(control);
    }
  }

  /** Detect presses on one pad since its last poll. */
  private edges(pad: GamepadSnapshot, state: PadState, index: number): void {
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      const down = b ? b.pressed || b.value > BUTTON_PRESS : false;
      if (down && !state.buttons[i]) this.press(state, index, padButton(i));
      state.buttons[i] = down;
    }
    for (let i = 0; i < pad.axes.length; i++) {
      const v = pad.axes[i] ?? 0;
      const was = state.axes[i] ?? 0;
      const held = was !== 0 && v * was >= AXIS_RELEASE;
      const now = held ? was : v <= -AXIS_PRESS ? -1 : v >= AXIS_PRESS ? 1 : 0;
      if (now !== 0 && now !== was) this.press(state, index, padAxis(i, now as -1 | 1));
      state.axes[i] = now;
    }
  }

  private press(state: PadState, pad: number, control: ControlId): void {
    if (state.blocked.has(control)) return;
    if (this.pending.length >= MAX_PENDING_PRESSES) this.pending.shift();
    this.pending.push({ pad, control });
    state.lastActivity = this.clock.next();
  }

  level(control: ControlId): number {
    const pad = this.current;
    if (!pad || this.suspended) return 0;
    if (this.states.get(pad.index)?.blocked.has(control)) return 0;
    return this.shapedLevel(pad, control);
  }

  private shapedLevel(pad: GamepadSnapshot, control: ControlId): number {
    const parsed = parsePadControl(control);
    if (!parsed) return 0;
    const shaping = this.shaping();
    if (parsed.kind === 'button') {
      return applyAxisCurve(pad.buttons[parsed.index]?.value ?? 0, shaping.trigger);
    }
    const v = (pad.axes[parsed.index] ?? 0) * parsed.direction;
    return applyAxisCurve(v, shaping.stick);
  }

  /** Raw (unshaped) axis value of the active pad, for diagnostics. */
  rawAxis(index: number): number {
    return this.current?.axes[index] ?? 0;
  }

  /** Raw button value of the active pad, for diagnostics. */
  rawButton(index: number): number {
    return this.current?.buttons[index]?.value ?? 0;
  }

  /** Presses from the pad being read only, so they agree with the levels it reports. */
  drainPresses(): readonly ControlId[] {
    const out = this.drained;
    out.length = 0;
    const index = this.current?.index;
    for (const press of this.pending) if (press.pad === index) out.push(press.control);
    this.pending.length = 0;
    return out;
  }

  drainChanges(): readonly DeviceChange[] {
    const out = this.changes;
    this.changes = this.drainedChanges;
    this.changes.length = 0;
    this.drainedChanges = out;
    return out;
  }

  /**
   * Focus lost: drop queued presses and, on the next poll, block every control still held until
   * it is let go. Pads are polled, so without this a held trigger would act again at once.
   */
  releaseAll(): void {
    this.pending.length = 0;
    this.latchHeld = true;
  }

  rumble(strong: number, weak: number, duration: number): void {
    if (this.current && this.rumblePort) {
      this.rumblePort.play(this.current.index, strong, weak, duration);
    }
  }

  stopRumble(): void {
    if (this.current && this.rumblePort) this.rumblePort.stop(this.current.index);
  }
}
