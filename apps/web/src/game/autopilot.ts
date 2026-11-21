import type { InputSystem } from '@undercut/input';
import type { CarParams, CarState } from '@undercut/sim';
import { createVec3, smoothClosed, type Track } from '@undercut/track';
import type { ControlSource, DriverFrame } from './loop';

/** Which of the four driving keys an autopilot holds this tick. */
export interface DrivingKeys {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
}

export interface AutopilotOptions {
  /** Share of the estimated grip the speed profile uses; lower is safer. */
  gripUse: number;
  /** Braking deceleration as a multiple of the cornering limit. */
  brakeUse: number;
}

const DEFAULTS: AutopilotOptions = { gripUse: 0.78, brakeUse: 0.8 };
const G = 9.80665;
const AIR = 1.184;
/** Peak tyre friction the profile assumes before `gripUse`. */
const MU = 1.6;
/** Highest target speed, m/s; the car's own drag sets the real top speed. */
const V_MAX = 100;

/**
 * A test and tooling driver that uses only what a keyboard player has: four digital keys. It
 * follows the centreline by pure pursuit and a speed profile from the track's curvature, and
 * presses left, right, throttle and brake on the input layer's keyboard source, so its demand
 * goes through the real keyboard shaping and assists. It is not the AI driver (packages/ai);
 * it exists to prove a lap can be driven on the keyboard with the default assists.
 */
export class KeyboardAutopilot {
  private readonly track: Track;
  private readonly wheelbase: number;
  private readonly maxSteer: number;
  /** Target speed per lap sample, m/s. */
  readonly profile: Float64Array;
  private readonly hint = { index: -1 };
  private readonly q = { s: 0, d: 0, index: -1 };
  private readonly p = createVec3();

  constructor(track: Track, params: CarParams, options: Partial<AutopilotOptions> = {}) {
    const o = { ...DEFAULTS, ...options };
    this.track = track;
    this.wheelbase = params.geometry.wheelbase;
    this.maxSteer = params.geometry.maxSteerAngle;
    this.profile = speedProfile(track, params, o);
  }

  /** Forget the search position (after a teleport). */
  reset(): void {
    this.hint.index = -1;
  }

  /** Target speed at lap position s. */
  targetSpeed(s: number): number {
    const step = this.track.lap.step;
    const n = this.profile.length;
    const i = Math.floor(this.track.wrap(s) / step) % n;
    return this.profile[i] as number;
  }

  /**
   * Keys for this tick. `steer` is the shaped steering demand the car received last tick, the
   * thing a player watches the wheel for.
   */
  decide(car: CarState, steer: number, out: DrivingKeys): DrivingKeys {
    const track = this.track;
    const v = Math.max(0, car.vx);
    const q = track.project(car.x, car.z, this.hint, this.q);
    // Pure pursuit on the centreline, a little inside of it on the way back from an edge.
    const look = Math.min(36, Math.max(7, 6 + 0.3 * v));
    track.pointAt(track.wrap(q.s + look), 0, this.p);
    const dx = this.p.x - car.x;
    const dz = this.p.z - car.z;
    const c = Math.cos(car.yaw);
    const sn = Math.sin(car.yaw);
    const fwd = dx * c - dz * sn;
    const left = -dx * sn - dz * c;
    const dist2 = Math.max(1, fwd * fwd + left * left);
    const curvature = (2 * left) / dist2;
    const demand = Math.atan(curvature * this.wheelbase) / this.maxSteer;
    const band = 0.01;
    out.left = demand > steer + band;
    out.right = demand < steer - band;

    // Speed: aim for the profile a short way ahead, so the pedals' ramps have time to act.
    const target = Math.min(this.targetSpeed(q.s + v * 0.35 + 4), this.targetSpeed(q.s));
    out.throttle = v < target - 0.5;
    out.brake = v > target + 1.5;
    return out;
  }
}

/** Target speed per lap sample from curvature, grip with downforce, and a braking pass. */
function speedProfile(track: Track, params: CarParams, o: AutopilotOptions): Float64Array {
  const n = track.lap.count;
  const step = track.lap.step;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = Math.abs(track.curvatureAt(i * step));
  const kappa = smoothClosed(raw, 4);
  const mass = params.mass.dryMass + 20;
  const dfPerV2 = (0.5 * AIR * params.aero.clA) / mass;
  const lateral = (v: number): number => o.gripUse * MU * (G + dfPerV2 * v * v);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.max(1e-5, kappa[i] as number);
    // Solve v² k = mu (g + c v²) for v: v² = mu g / (k - mu c).
    const mu = o.gripUse * MU;
    const den = k - mu * dfPerV2;
    v[i] = den <= 0 ? V_MAX : Math.min(V_MAX, Math.sqrt((mu * G) / den));
  }
  // Backward passes: the car must be able to brake down to every corner speed.
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 2 * n - 1; j >= 0; j--) {
      const i = j % n;
      const next = (i + 1) % n;
      const vn = v[next] as number;
      const a = o.brakeUse * lateral(vn);
      const reach = Math.sqrt(vn * vn + 2 * a * step);
      if ((v[i] as number) > reach) v[i] = reach;
    }
  }
  return v;
}

/** The player's input layer as a control source. */
export class InputControlSource implements ControlSource {
  constructor(readonly input: InputSystem) {}

  sample(dt: number, speed: number): DriverFrame {
    return this.input.sample(dt, speed);
  }
}

const KEYS = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  throttle: 'ArrowUp',
  brake: 'ArrowDown',
} as const;

/**
 * Drives through the real keyboard path: before each sample it presses or releases the arrow
 * keys on the input layer's keyboard source as the autopilot decides.
 */
export class AutopilotControlSource implements ControlSource {
  private readonly keys: DrivingKeys = { left: false, right: false, throttle: false, brake: false };
  private lastSteer = 0;

  constructor(
    readonly input: InputSystem,
    readonly pilot: KeyboardAutopilot,
    private readonly car: () => CarState,
  ) {}

  sample(dt: number, speed: number): DriverFrame {
    const keys = this.pilot.decide(this.car(), this.lastSteer, this.keys);
    const kb = this.input.keyboard;
    for (const name of ['left', 'right', 'throttle', 'brake'] as const) {
      const code = KEYS[name];
      if (keys[name] && !kb.isHeld(code)) kb.keyDown(code);
      else if (!keys[name] && kb.isHeld(code)) kb.keyUp(code);
    }
    const frame = this.input.sample(dt, speed);
    this.lastSteer = frame.control.steer;
    return frame;
  }

  /** Let go of every key (when the autopilot is switched off). */
  release(): void {
    for (const code of Object.values(KEYS)) this.input.keyboard.keyUp(code);
  }
}
