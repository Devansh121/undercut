import { createRng, type Rng } from '@undercut/core';
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
  /** Pure-pursuit look-ahead: metres per m/s and the longest, m. */
  lookGain: number;
  lookMax: number;
  /** Steering correction per rad/s of yaw-rate error, rad. */
  yawDamping: number;
  /** Share of the estimated grip the speed profile uses; lower is safer. */
  gripUse: number;
  /** Braking deceleration as a multiple of the cornering limit. */
  brakeUse: number;
  /**
   * Drive like a clumsy keyboard player (seeded): pedals pressed `reaction` seconds after the
   * need, every corner braked for a little late or early and floored before the exit.
   */
  clumsy?: ClumsyOptions;
}

export interface ClumsyOptions {
  seed: number;
  /** Delay between seeing the need and pressing a pedal, s. */
  reaction?: number;
  /** Per corner, drawn from [min, max]: braking this many metres late (negative: early). */
  brakeLate?: readonly [number, number];
  /** Per corner: full throttle this many metres before the exit asks for it. */
  throttleEarly?: readonly [number, number];
}

const DEFAULTS: AutopilotOptions = {
  lookGain: 0.5,
  lookMax: 50,
  yawDamping: 0.05,
  gripUse: 0.75,
  brakeUse: 0.7,
};
const CLUMSY_DEFAULTS = {
  reaction: 0.2,
  brakeLate: [-10, 40] as const,
  throttleEarly: [10, 50] as const,
};
/**
 * The clumsy player's autopilot settings: nearer the limit than the careful default, so its
 * mistakes have consequences (the debug API's `clumsyPilot`, the browser lap test).
 */
export const CLUMSY_PILOT: Readonly<Partial<AutopilotOptions>> = Object.freeze({
  gripUse: 0.9,
  brakeUse: 0.85,
});
/** The sim step the pedal delay counts in (ADR 0007). */
const TICK = 1 / 240;
const G = 9.80665;
const AIR = 1.184;
/** Peak tyre friction the profile assumes before `gripUse` (the sim's tyres peak near 1.8). */
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
  private readonly lookGain: number;
  private readonly lookMax: number;
  private readonly yawDamping: number;
  /** Target speed per lap sample, m/s. */
  readonly profile: Float64Array;
  private readonly hint = { index: -1 };
  private readonly q = { s: 0, d: 0, index: -1 };
  private readonly p = createVec3();
  private readonly clumsy: Clumsiness | null;

  constructor(track: Track, params: CarParams, options: Partial<AutopilotOptions> = {}) {
    const o = { ...DEFAULTS, ...options };
    this.clumsy = o.clumsy ? new Clumsiness(track, o.clumsy) : null;
    this.track = track;
    this.wheelbase = params.geometry.wheelbase;
    this.maxSteer = params.geometry.maxSteerAngle;
    this.lookGain = o.lookGain;
    this.lookMax = o.lookMax;
    this.yawDamping = o.yawDamping;
    this.profile = speedProfile(track, params, o);
  }

  /** Forget the search position and anything held (after a teleport). */
  reset(): void {
    this.hint.index = -1;
    this.clumsy?.reset();
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
    const look = Math.min(this.lookMax, Math.max(7, 6 + this.lookGain * v));
    track.pointAt(track.wrap(q.s + look), 0, this.p);
    const dx = this.p.x - car.x;
    const dz = this.p.z - car.z;
    const c = Math.cos(car.yaw);
    const sn = Math.sin(car.yaw);
    const fwd = dx * c - dz * sn;
    const left = -dx * sn - dz * c;
    const dist2 = Math.max(1, fwd * fwd + left * left);
    const curvature = (2 * left) / dist2;
    // Yaw damping: steer against the yaw rate the path does not ask for, so the car settles
    // instead of weaving under the keys' on-off steering.
    const yawError = car.yawRate - curvature * v;
    const demand =
      (Math.atan(curvature * this.wheelbase) - this.yawDamping * yawError) / this.maxSteer;
    const band = 0.01;
    out.left = demand > steer + band;
    out.right = demand < steer - band;

    // Speed: aim for the profile a short way ahead, so the pedals' ramps have time to act.
    const clumsy = this.clumsy;
    const late = clumsy ? clumsy.late(q.s) : 0;
    const early = clumsy ? clumsy.early(q.s) : 0;
    const target = (at: number): number =>
      Math.min(this.targetSpeed(at + v * 0.35 + 4), this.targetSpeed(at));
    const throttle = v < target(q.s + early) - 0.5;
    const brake = v > target(q.s - late) + 1.5;
    if (!clumsy) {
      out.throttle = throttle;
      out.brake = brake;
      return out;
    }
    clumsy.press(throttle && !brake, brake, out);
    return out;
  }
}

/** A clumsy player's mistakes and slow feet, for `KeyboardAutopilot`. */
class Clumsiness {
  private readonly rng: Rng;
  private readonly track: Track;
  private readonly delay: number;
  private readonly ring = new Uint8Array(512);
  private head = 0;
  private readonly lateRange: readonly [number, number];
  private readonly earlyRange: readonly [number, number];
  private readonly lates: Float64Array;
  private readonly earlies: Float64Array;
  private prevS = -1;

  constructor(track: Track, o: ClumsyOptions) {
    this.track = track;
    this.rng = createRng(o.seed);
    this.delay = Math.min(511, Math.round((o.reaction ?? CLUMSY_DEFAULTS.reaction) / TICK));
    this.lateRange = o.brakeLate ?? CLUMSY_DEFAULTS.brakeLate;
    this.earlyRange = o.throttleEarly ?? CLUMSY_DEFAULTS.throttleEarly;
    this.lates = new Float64Array(track.corners.length);
    this.earlies = new Float64Array(track.corners.length);
    this.newLap();
  }

  reset(): void {
    this.ring.fill(0);
    this.head = 0;
    this.prevS = -1;
  }

  private newLap(): void {
    const r = this.rng;
    for (let k = 0; k < this.lates.length; k++) {
      this.lates[k] = this.lateRange[0] + (this.lateRange[1] - this.lateRange[0]) * r.next();
      this.earlies[k] = this.earlyRange[0] + (this.earlyRange[1] - this.earlyRange[0]) * r.next();
    }
  }

  /** The corner whose exit is next along the lap from `s`. */
  private corner(s: number): number {
    if (this.prevS >= 0 && this.prevS - s > this.track.length / 2) this.newLap();
    this.prevS = s;
    const cs = this.track.corners;
    let best = 0;
    let dist = Infinity;
    for (let k = 0; k < cs.length; k++) {
      const d = this.track.forwardDistance(s, cs[k]!.end);
      if (d < dist) {
        dist = d;
        best = k;
      }
    }
    return best;
  }

  late(s: number): number {
    return this.lates[this.corner(s)]!;
  }

  early(s: number): number {
    return this.earlies[this.corner(s)]!;
  }

  /** Record what the pedals should do now; press what was needed `reaction` ago. */
  press(throttle: boolean, brake: boolean, out: DrivingKeys): void {
    const h = this.head;
    this.ring[h] = (throttle ? 1 : 0) | (brake ? 2 : 0);
    this.head = (h + 1) % this.ring.length;
    const seen = this.ring[(h - this.delay + this.ring.length) % this.ring.length]!;
    out.throttle = (seen & 1) !== 0;
    out.brake = (seen & 2) !== 0;
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

/**
 * A fixed ControlInput set by a test or tool through the debug API. The player's devices are
 * still sampled for one-shot actions (pause, camera, reset), so a scripted drive can be paused
 * from the keyboard like any other.
 */
export class ScriptedControlSource implements ControlSource {
  private readonly frame: {
    control: DriverFrame['control'];
    device: DriverFrame['device'];
    lookBack: boolean;
    events: DriverFrame['events'];
  };
  private pendingShift: -1 | 0 | 1 = 0;

  constructor(private readonly input: InputSystem | null = null) {
    this.frame = {
      control: {
        steer: 0,
        throttle: 0,
        brake: 0,
        gearShift: 0,
        drs: false,
        overtake: false,
        pitLimiter: false,
      },
      device: 'keyboard',
      lookBack: false,
      events: [],
    };
  }

  /** Merge `control` into the held demand. A gear shift is sent for one tick only. */
  set(control: Partial<DriverFrame['control']>): void {
    const { gearShift, ...rest } = control;
    Object.assign(this.frame.control, rest);
    if (gearShift) this.pendingShift = gearShift;
  }

  sample(dt: number, speed: number): DriverFrame {
    this.frame.control.gearShift = this.pendingShift;
    this.pendingShift = 0;
    if (this.input) {
      const live = this.input.sample(dt, speed);
      this.frame.events = live.events;
      this.frame.lookBack = live.lookBack;
    }
    return this.frame;
  }
}
