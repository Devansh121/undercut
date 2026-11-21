import { padAxis, padButton, parsePadControl, type ControlId } from '../controls';
import { applyAxisCurve, type GamepadShaping } from '../shaping';
import { pushPress, type ActivityClock, type DeviceChange, type DeviceSource } from './source';

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
}

/** Gamepads, polled once per sample. The most recently used pad drives the car. */
export class GamepadSource implements DeviceSource {
  readonly kind = 'gamepad' as const;
  lastActivity = 0;
  private readonly states = new Map<number, PadState>();
  private current: GamepadSnapshot | null = null;
  private presses: ControlId[] = [];
  private drained: ControlId[] = [];
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
        state = { id: pad.id, buttons: [], axes: [], lastActivity: 0 };
        this.states.set(pad.index, state);
        this.changes.push({ type: 'connected', device: 'gamepad', id: pad.id });
      }
      // Browsers reveal a pad only after a button press, so whatever is down on the first
      // poll counts as a press: it is the input that made the pad appear.
      this.edges(pad, state);
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
  }

  /** Detect presses on one pad since its last poll. */
  private edges(pad: GamepadSnapshot, state: PadState): void {
    for (let i = 0; i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      const down = b ? b.pressed || b.value > BUTTON_PRESS : false;
      if (down && !state.buttons[i]) this.press(state, padButton(i));
      state.buttons[i] = down;
    }
    for (let i = 0; i < pad.axes.length; i++) {
      const v = pad.axes[i] ?? 0;
      const was = state.axes[i] ?? 0;
      const held = was !== 0 && v * was >= AXIS_RELEASE;
      const now = held ? was : v <= -AXIS_PRESS ? -1 : v >= AXIS_PRESS ? 1 : 0;
      if (now !== 0 && now !== was) this.press(state, padAxis(i, now as -1 | 1));
      state.axes[i] = now;
    }
  }

  private press(state: PadState, control: ControlId): void {
    pushPress(this.presses, control);
    state.lastActivity = this.clock.next();
    this.lastActivity = state.lastActivity;
  }

  level(control: ControlId): number {
    const pad = this.current;
    if (!pad) return 0;
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

  drainPresses(): readonly ControlId[] {
    const out = this.presses;
    this.presses = this.drained;
    this.presses.length = 0;
    this.drained = out;
    return out;
  }

  drainChanges(): readonly DeviceChange[] {
    const out = this.changes;
    this.changes = this.drainedChanges;
    this.changes.length = 0;
    this.drainedChanges = out;
    return out;
  }

  releaseAll(): void {
    // Pads are polled, so there is nothing latched to release; presses already queued stay.
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
