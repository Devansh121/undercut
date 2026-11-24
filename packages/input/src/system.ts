import { clamp } from '@undercut/core';
import { resetControlInput, type ControlInput } from '@undercut/sim';
import {
  type AnalogAction,
  ACTIONS,
  contextOf,
  isAnalogAction,
  type ButtonAction,
  type DeviceKind,
  type InputContext,
} from './actions';
import { DeviceArbiter } from './arbiter';
import { KeyboardAxisShaper, PASS_THROUGH, type AxisShaper, type Axes } from './axis-shaper';
import { controlsFor, defaultProfile, type InputProfile } from './bindings';
import { deviceOfControl, type ControlId } from './controls';
import { GamepadSource, type GamepadReader, type RumblePort } from './sources/gamepad';
import { KeyboardSource } from './sources/keyboard';
import { ActivityClock, type DeviceSource } from './sources/source';
import { TouchSource } from './sources/touch';

/** One-shot things that happened during a sample, for UI, camera and settings. */
export type InputEvent =
  | { type: 'action'; action: ButtonAction }
  | { type: 'activeDevice'; device: DeviceKind }
  | { type: 'connected' | 'disconnected'; device: DeviceKind; id: string }
  | { type: 'captured'; device: DeviceKind; control: ControlId };

/** Result of one sample. The object is reused: copy what you keep past the next sample. */
export interface InputFrame {
  /** Driver demand for this sim tick. */
  readonly control: ControlInput;
  /** Mapped demand before the device's ramps, for diagnostics. */
  readonly demand: Axes;
  /** Look-back camera held. */
  lookBack: boolean;
  /** The device driving the car and whose prompts the HUD shows. */
  device: DeviceKind;
  readonly events: InputEvent[];
}

export interface InputSystemOptions {
  /** `navigator.getGamepads` or a fake. Omit for no gamepad support. */
  readGamepads?: GamepadReader;
  rumble?: RumblePort | null;
  profile?: InputProfile;
  /** Start with touch prompts (phones and tablets). */
  touchCapable?: boolean;
}

/** Actions that become one-shot events instead of car demand. */
const EVENT_ACTIONS: ReadonlySet<ButtonAction> = new Set<ButtonAction>([
  'nextCamera',
  'pause',
  'resetToTrack',
  'menuUp',
  'menuDown',
  'menuLeft',
  'menuRight',
  'menuAccept',
  'menuBack',
  'menuTabPrev',
  'menuTabNext',
]);

/** Pending gear requests kept between ticks; more than this in one tick is not a real driver. */
const MAX_PENDING_SHIFTS = 8;
/** Above this a held button counts as down. */
const HELD = 0.5;
/** Brake demand that cancels a toggled DRS request, as braking closes the flap. */
const DRS_CANCEL_BRAKE = 0.1;

/**
 * The input layer's face to the game. The game loop calls `sample(dt, speed)` once per sim
 * tick; it polls the sources, picks the active device, maps controls to actions through the
 * binding map, shapes the axes and returns a `ControlInput` plus one-shot events. No timers.
 */
export class InputSystem {
  readonly keyboard: KeyboardSource;
  readonly gamepad: GamepadSource;
  readonly touch: TouchSource;
  private readonly sources: readonly DeviceSource[];
  private readonly arbiter: DeviceArbiter;
  private readonly shapers: Record<DeviceKind, AxisShaper>;
  private profileValue: InputProfile;
  private contextValue: InputContext = 'driving';
  private captureDevice: DeviceKind | null = null;
  private readonly shifts: (-1 | 1)[] = [];
  private drsRequest = false;
  private pitLimiter = false;
  private focused = true;
  private readonly frame: InputFrame;

  constructor(options: InputSystemOptions = {}) {
    const clock = new ActivityClock();
    this.profileValue = options.profile ?? defaultProfile();
    this.keyboard = new KeyboardSource(clock);
    this.gamepad = new GamepadSource(
      options.readGamepads ?? (() => []),
      clock,
      () => this.profileValue.shaping.gamepad,
      options.rumble ?? null,
    );
    this.touch = new TouchSource(clock, () => this.profileValue.shaping.touch);
    this.sources = [this.keyboard, this.gamepad, this.touch];
    this.arbiter = new DeviceArbiter(options.touchCapable ? 'touch' : 'keyboard');
    this.shapers = {
      keyboard: new KeyboardAxisShaper(() => this.profileValue.shaping.keyboard),
      gamepad: PASS_THROUGH,
      touch: PASS_THROUGH,
    };
    this.frame = {
      control: resetControlInput({} as ControlInput),
      demand: { steer: 0, throttle: 0, brake: 0 },
      lookBack: false,
      device: this.arbiter.active,
      events: [],
    };
  }

  get profile(): InputProfile {
    return this.profileValue;
  }

  /** Swap bindings and shaping; takes effect on the next sample. */
  setProfile(profile: InputProfile): void {
    this.profileValue = profile;
  }

  get context(): InputContext {
    return this.contextValue;
  }

  /** Driving maps car controls; menu maps navigation and leaves the car neutral. */
  setContext(context: InputContext): void {
    if (context === this.contextValue) return;
    this.contextValue = context;
    this.shifts.length = 0;
    this.drsRequest = false;
  }

  get activeDevice(): DeviceKind {
    return this.arbiter.active;
  }

  /** The device whose next press is being captured for rebinding, or null. */
  get capturing(): DeviceKind | null {
    return this.captureDevice;
  }

  /** Report the next press from `device` as a `captured` event instead of acting on it. */
  startCapture(device: DeviceKind): void {
    this.captureDevice = device;
  }

  cancelCapture(): void {
    this.captureDevice = null;
  }

  /** True when `code` is bound to an action in the current context (for scroll prevention). */
  isKeyBound(code: string): boolean {
    const control = `key:${code}`;
    const map = this.profileValue.bindings;
    return ACTIONS.some(
      (a) =>
        contextOf(a) === this.contextValue && controlsFor(map, 'keyboard', a).includes(control),
    );
  }

  /** Force feedback on the active pad; nothing when the player is not on a gamepad. */
  rumble(strong: number, weak: number, duration: number): void {
    if (this.arbiter.active === 'gamepad') this.gamepad.rumble(strong, weak, duration);
  }

  /** Stop any rumble playing on the pad. */
  stopRumble(): void {
    this.gamepad.stopRumble();
  }

  /** Let go of every held control on every device (window blur, tab hidden). */
  releaseAll(): void {
    for (const source of this.sources) source.releaseAll();
  }

  /** Whether the page has focus and is visible. */
  get hasFocus(): boolean {
    return this.focused;
  }

  /**
   * Page focus. While unfocused or hidden every device is released, the car gets neutral
   * demand and presses are dropped; after focus returns, anything still held on a gamepad must
   * be let go before it counts again.
   */
  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    this.releaseAll();
    this.gamepad.setSuspended(!focused);
  }

  private source(kind: DeviceKind): DeviceSource {
    return kind === 'keyboard' ? this.keyboard : kind === 'gamepad' ? this.gamepad : this.touch;
  }

  /** Pull input for one sim tick of `dt` seconds with the car at `speed` m/s. */
  sample(dt: number, speed: number): InputFrame {
    const frame = this.frame;
    const events = frame.events;
    events.length = 0;

    for (const source of this.sources) source.poll();
    for (const source of this.sources) {
      for (const change of source.drainChanges()) events.push({ ...change });
    }
    if (this.arbiter.update(this.sources)) {
      this.shapers[this.arbiter.active].seed(frame.control);
      events.push({ type: 'activeDevice', device: this.arbiter.active });
    }
    const device = this.arbiter.active;
    frame.device = device;

    if (!this.focused) {
      for (const source of this.sources) source.drainPresses();
      this.neutral();
      return frame;
    }

    if (this.captureDevice !== null) {
      this.capture(events);
      this.neutral();
      return frame;
    }

    const map = this.profileValue.bindings;
    const active = this.source(device);
    const driving = this.contextValue === 'driving';

    // Presses: only the active device's count (a press makes its device active first).
    for (const source of this.sources) {
      const presses = source.drainPresses();
      if (source !== active) continue;
      for (const control of presses) this.onPress(control, device, events);
    }

    if (!driving) {
      this.neutral();
      return frame;
    }

    const level = (action: AnalogAction | ButtonAction): number => {
      let v = 0;
      for (const control of controlsFor(map, device, action))
        v = Math.max(v, active.level(control));
      return v;
    };
    const demand = frame.demand;
    demand.steer = level('steerLeft') - level('steerRight');
    demand.throttle = level('throttle');
    demand.brake = level('brake');

    const control = frame.control;
    this.shapers[device].shape(demand, dt, speed, control);
    control.steer = clamp(control.steer, -1, 1);
    control.throttle = clamp(control.throttle, 0, 1);
    control.brake = clamp(control.brake, 0, 1);

    const shaping = this.profileValue.shaping;
    if (shaping.drsMode === 'hold') this.drsRequest = level('drs') > HELD;
    else if (control.brake > DRS_CANCEL_BRAKE) this.drsRequest = false;
    control.drs = this.drsRequest;
    control.overtake = level('overtake') > HELD;
    control.pitLimiter = this.pitLimiter;
    control.gearShift = this.shifts.shift() ?? 0;
    frame.lookBack = level('lookBack') > HELD;
    return frame;
  }

  private onPress(control: ControlId, device: DeviceKind, events: InputEvent[]): void {
    const map = this.profileValue.bindings;
    for (const action of ACTIONS) {
      if (isAnalogAction(action) || contextOf(action) !== this.contextValue) continue;
      if (!controlsFor(map, device, action).includes(control)) continue;
      if (EVENT_ACTIONS.has(action)) events.push({ type: 'action', action });
      else if (action === 'gearUp' || action === 'gearDown') {
        if (this.shifts.length < MAX_PENDING_SHIFTS) this.shifts.push(action === 'gearUp' ? 1 : -1);
      } else if (action === 'drs') {
        if (this.profileValue.shaping.drsMode === 'toggle') this.drsRequest = !this.drsRequest;
      } else if (action === 'pitLimiter') this.pitLimiter = !this.pitLimiter;
    }
  }

  private capture(events: InputEvent[]): void {
    let captured: ControlId | null = null;
    for (const source of this.sources) {
      const presses = source.drainPresses();
      if (captured !== null || source.kind !== this.captureDevice) continue;
      for (const control of presses) {
        if (deviceOfControl(control) === this.captureDevice) {
          captured = control;
          break;
        }
      }
    }
    if (captured !== null && this.captureDevice !== null) {
      events.push({ type: 'captured', device: this.captureDevice, control: captured });
      this.captureDevice = null;
    }
  }

  private neutral(): void {
    const frame = this.frame;
    resetControlInput(frame.control);
    frame.control.pitLimiter = this.pitLimiter;
    frame.demand.steer = 0;
    frame.demand.throttle = 0;
    frame.demand.brake = 0;
    frame.lookBack = false;
    this.shifts.length = 0;
    this.shapers.keyboard.seed(frame.control);
  }
}
