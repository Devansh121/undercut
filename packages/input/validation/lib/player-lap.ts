import {
  DRIVING_LINE_SCALE,
  buildPlan,
  racingLineOffsets,
  type DrivingPlan,
  type EnvelopeScale,
} from '@undercut/ai';
import {
  SurfaceKind,
  addCar,
  computeMass,
  createAssistState,
  createCarParams,
  createCarState,
  createWorld,
  restoreAssists,
  restoreCar,
  snapshotAssists,
  snapshotCar,
  stepWorld,
  type CarState,
  type ControlInput,
  type MassState,
} from '@undercut/sim';
import { TrackSurface, createGround, createPathPoint, type Track } from '@undercut/track';
import { loadEnvelope, loadLine, type CircuitSetup } from '../../../ai/validation/lib/index';
import type { DeviceKind } from '../../src/actions';
import {
  KeyboardAxisShaper,
  PASS_THROUGH,
  type AxisShaper,
  type Axes,
} from '../../src/axis-shaper';
import {
  applyDriverAids,
  type AssistConfig,
  type GuidePosition,
  type SpeedGuide,
} from '../../src/driver-aids';
import { DEFAULT_KEYBOARD_SHAPING, type KeyboardShaping } from '../../src/shaping';
import { Human, type CueSource, type HumanTraits } from './human';

const ZERO_AXES: Readonly<Axes> = Object.freeze({ steer: 0, throttle: 0, brake: 0 });

/** The game's sim step (ADR 0007). */
export const STEP = 1 / 240;
/** The game's time-trial fuel and rolling start (apps/web/src/game/session.ts). */
export const GAME_FUEL = 20;
export const ROLLING_START_SPEED = 150 / 3.6;
export const ROLLING_START_RUN_UP = 160;

/**
 * The newcomer's plan: the driving line's (the shipped racing line with speeds from less of the
 * envelope than the reference driver uses). What a player who knows the circuit a little aims for.
 */
export const NEWCOMER_SCALE: Readonly<EnvelopeScale> = DRIVING_LINE_SCALE;

/** Default cost of a spin, s (see `PlayerRunOptions.spinCost`). */
export const SPIN_COST = 5;

/** A spin: body sideslip past `SPIN_SIDESLIP`, or the car pointing more than 90° off the road. */
export const SPIN_SIDESLIP = (30 * Math.PI) / 180;
/** Ticks of history kept for a spin report (2 s), and the window summarised (0.5 s). */
const HISTORY = 480;
const WINDOW = 120;
/** A slide begins when sideslip passes this; a spin report describes the window before it. */
const SLIDE_ONSET = (4 * Math.PI) / 180;

export interface PlayerRunOptions {
  setup: CircuitSetup;
  device: DeviceKind;
  traits: HumanTraits;
  assists: AssistConfig;
  seed: number;
  /** Timed laps after the rolling start. */
  laps: number;
  /** The plan the human drives to; default the newcomer plan on the shipped line. */
  plan?: DrivingPlan;
  cues?: CueSource;
  /** The driving line's advised speeds for the braking help, as the game passes them. */
  guide?: SpeedGuide;
  /**
   * What a spin costs, s: added to the lap and counted as time off the track (a spun car
   * stops, turns round and rejoins, usually from the run-off). The car is then put back on the
   * line where it spun. Default `SPIN_COST`.
   */
  spinCost?: number;
  /** Keyboard shaping; default the game's. */
  shaping?: KeyboardShaping;
  /** Collect one row per tick here (diagnostics; see `TRACE_COLUMNS`). */
  trace?: number[][];
}

export const TRACE_COLUMNS = [
  't',
  's',
  'kmh',
  'steer_in',
  'steer_out',
  'throttle_in',
  'throttle_out',
  'brake_in',
  'brake_out',
  'gear',
  'beta_deg',
  'yaw_rate',
  'sr_rl',
  'sr_rr',
  'sa_rl',
  'sa_rr',
  'fz_rl',
  'fz_rr',
  'tc',
  'kerb',
  'rpm',
  'sa_fl',
  'sa_fr',
] as const;

/** What the car was doing in the half second before the slide that became a spin began. */
export interface SpinContext {
  /** Seconds from the slide's onset (sideslip past 4°) to the spin. */
  slideTime: number;
  /** Speed at the onset, km/h. */
  onsetKmh: number;
  /** Largest rear combined slip, as a multiple of the peak (1 = top of the curve). */
  rearSlip: number;
  /** Largest rear slip ratio in drive (wheelspin) and lowest slip ratio of any wheel (lock). */
  wheelspin: number;
  lock: number;
  /** Largest rear slip angle, degrees. */
  rearSlipAngle: number;
  /** Lowest rear wheel load, N. */
  rearLoadMin: number;
  /** Throttle and brake that reached the car, largest over the window. */
  throttle: number;
  brake: number;
  /** A downshift happened in the window; a wheel was on a kerb; lowest TC throttle scale. */
  downshift: boolean;
  kerb: boolean;
  /** Steer that reached the car: largest change over the window. */
  steerSwing: number;
}

export interface SpinEvent {
  lap: number;
  s: number;
  corner: number;
  phase: string;
  speedKmh: number;
  gear: number;
  lifting: boolean;
  before: SpinContext;
}

export interface PlayerRunResult {
  /** Timed laps finished. */
  laps: number;
  lapTimes: number[];
  /** Laps with no spin. */
  cleanLaps: number[];
  spins: SpinEvent[];
  /** Spins that ended against a barrier (struck in the 1.5 s before). */
  wallSpins: number;
  /**
   * Ticks with the car's centre on grass or gravel, plus `spinCost` seconds of ticks for each
   * spin.
   */
  offTicks: number;
  /** Ticks on which the steer reaching the car differed from the driver's by more than 0.15. */
  overrideTicks: number;
  maxSideslipDeg: number;
  reaction: number;
}

/** The newcomer plan for `setup` with `scale` of the envelope. */
export function newcomerPlan(
  setup: CircuitSetup,
  scale: EnvelopeScale = NEWCOMER_SCALE,
): DrivingPlan {
  const track = setup.track();
  return buildPlan(track, racingLineOffsets(loadLine(setup)), loadEnvelope(setup), { scale });
}

/**
 * Drive `laps` timed laps as a human on `device` with `assists`, through the game's own input
 * chain: device demand → axis shaper (the keyboard's ramps) → `applyDriverAids` → the car.
 * A spun car is put back on the line where it spun, slower, and the lap goes on.
 */
export function runPlayer(o: PlayerRunOptions): PlayerRunResult {
  const setup = o.setup;
  const plan = o.plan ?? newcomerPlan(setup);
  const track = plan.track;
  const params = createCarParams(setup.trim);
  const surface = new TrackSurface(track);
  const world = createWorld({
    step: STEP,
    seed: 1,
    surface,
    environment: { airDensity: setup.airDensity },
  });
  const line = plan.line;
  const n = line.count;
  const timing = track.wrap(setup.controlLine);
  const s0 = track.wrap(timing - ROLLING_START_RUN_UP);
  const i0 = Math.round(s0 / track.lap.step) % n;
  const car = addCar(world, params, {
    x: line.x[i0]!,
    z: line.z[i0]!,
    yaw: line.heading[i0]!,
    speed: ROLLING_START_SPEED,
    fuel: GAME_FUEL,
    airDensity: setup.airDensity,
  });
  const human = new Human({
    device: o.device,
    traits: o.traits,
    plan,
    seed: o.seed,
    steeringHelp: o.assists.steering,
    ...(o.cues ? { cues: o.cues } : {}),
  });
  const shaper: AxisShaper =
    o.device === 'keyboard'
      ? new KeyboardAxisShaper(() => o.shaping ?? DEFAULT_KEYBOARD_SHAPING)
      : PASS_THROUGH;
  const memory = createAssistState();
  const demand: Axes = { steer: 0, throttle: 0, brake: 0 };
  const shaped: Axes = { steer: 0, throttle: 0, brake: 0 };
  const control: ControlInput = {
    steer: 0,
    throttle: 0,
    brake: 0,
    gearShift: 0,
    drs: false,
    overtake: false,
    pitLimiter: false,
  };
  const wheels = new WheelSurfaces(track);
  const history = new History();
  const q = createPathPoint();
  const hint = { index: -1 };

  const result: PlayerRunResult = {
    laps: 0,
    lapTimes: [],
    cleanLaps: [],
    spins: [],
    wallSpins: 0,
    offTicks: 0,
    overrideTicks: 0,
    maxSideslipDeg: 0,
    reaction: human.reaction,
  };
  let lapIndex = -1;
  let lapStart = 0;
  let lapSpins = 0;
  let penalty = 0;
  let lastWall = -Infinity;
  const spinCost = o.spinCost ?? SPIN_COST;
  const ground = createGround();
  const where: GuidePosition | undefined = o.guide ? { guide: o.guide, s: 0 } : undefined;
  let prevS = track.project(car.state.x, car.state.z, hint, q).s;
  let prevT = 0;
  let prevGear = car.state.gear;
  const maxTime = (o.laps + 1) * 240;

  while (world.time < maxTime && lapIndex < o.laps) {
    const st = car.state;
    human.tick(st, shaped.steer, STEP, demand);
    shaper.shape(demand, STEP, st.vx, shaped);
    control.steer = shaped.steer;
    control.throttle = shaped.throttle;
    control.brake = shaped.brake;
    if (where) where.s = prevS;
    applyDriverAids(o.device, o.assists, memory, st, control, STEP, car.input, where);
    if (lapIndex >= 0 && Math.abs(car.input.steer - control.steer) > 0.15) result.overrideTicks++;
    stepWorld(world);
    if (st.wallImpactSpeed > 0) lastWall = world.time;

    const t = world.time;
    const s = track.project(st.x, st.z, hint, q).s;
    const beta = Math.atan2(st.vy, Math.max(Math.abs(st.vx), 1));
    const k = Math.floor(s / track.lap.step) % n;
    const off = Math.abs(wrapAngle(st.yaw - line.heading[k]!));
    const kinds = wheels.read(st);
    history.push(st, memory.tcScale, kinds.kerb, st.gear < prevGear);
    if (o.trace) {
      const deg = 180 / Math.PI;
      o.trace.push([
        t,
        s,
        st.vx * 3.6,
        control.steer,
        car.input.steer,
        control.throttle,
        car.input.throttle,
        control.brake,
        car.input.brake,
        st.gear,
        beta * deg,
        st.yawRate,
        st.slipRatio[2]!,
        st.slipRatio[3]!,
        Math.atan(st.slipTan[2]!) * deg,
        Math.atan(st.slipTan[3]!) * deg,
        st.load[2]!,
        st.load[3]!,
        memory.tcScale,
        kinds.kerb ? 1 : 0,
        (st.engineSpeed * 60) / (2 * Math.PI),
        Math.atan(st.slipTan[0]!) * deg,
        Math.atan(st.slipTan[1]!) * deg,
      ]);
    }
    prevGear = st.gear;

    if (track.crossed(prevS, s, timing)) {
      const ds = track.forwardDistance(prevS, s);
      const tc = prevT + (t - prevT) * (ds > 0 ? track.forwardDistance(prevS, timing) / ds : 1);
      if (lapIndex >= 0) {
        result.lapTimes.push(tc - lapStart + penalty);
        if (lapSpins === 0) result.cleanLaps.push(tc - lapStart);
        result.laps++;
      }
      lapIndex++;
      lapStart = tc;
      lapSpins = 0;
      penalty = 0;
    }
    if (lapIndex >= 0 && lapIndex < o.laps) {
      const centre = track.ground(q.s, q.d, ground).kind;
      if (centre === SurfaceKind.Grass || centre === SurfaceKind.Gravel) result.offTicks++;
      result.maxSideslipDeg = Math.max(result.maxSideslipDeg, (Math.abs(beta) * 180) / Math.PI);
      const spun = (Math.abs(beta) > SPIN_SIDESLIP && st.vx > 8) || off > Math.PI / 2;
      if (spun) {
        result.spins.push({
          lap: lapIndex,
          s,
          corner: human.state.corner,
          phase: human.state.phase,
          speedKmh: Math.hypot(st.vx, st.vy) * 3.6,
          gear: st.gear,
          lifting: human.state.lifting,
          before: history.summary(),
        });
        lapSpins++;
        if (t - lastWall < 1.5) result.wallSpins++;
        penalty += spinCost;
        result.offTicks += Math.round(spinCost / STEP);
        // Back on the line where it spun, at half the plan's speed.
        const sr = s;
        const ir = Math.round(sr / track.lap.step) % n;
        const speed = Math.max(15, 0.5 * plan.profile.v[ir]!);
        const fresh = createCarState(params, {
          x: line.x[ir]!,
          z: line.z[ir]!,
          yaw: line.heading[ir]!,
          speed,
          fuel: st.fuelMass,
          airDensity: setup.airDensity,
          surface,
        });
        restoreCar(st, snapshotCar(fresh));
        restoreAssists(memory, snapshotAssists(createAssistState()));
        human.reset();
        shaper.seed(ZERO_AXES);
        history.clear();
        prevS = track.project(st.x, st.z, hint, q).s;
        prevT = t;
        continue;
      }
    }
    prevS = s;
    prevT = t;
  }
  return result;
}

const TWO_PI = 2 * Math.PI;
function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

/** The surface under each wheel centre. */
class WheelSurfaces {
  private readonly hints = [{ index: -1 }, { index: -1 }, { index: -1 }, { index: -1 }];
  private readonly q = createPathPoint();
  private readonly g = createGround();
  private readonly mass: MassState = {
    total: 0,
    sprung: 0,
    a: 0,
    b: 0,
    sprungA: 0,
    sprungB: 0,
    yawInertia: 0,
  };
  readonly out = { kerb: false, grass: 0 };
  constructor(private readonly track: Track) {}
  read(st: CarState): { kerb: boolean; grass: number } {
    const m = computeMass(st.model, st.fuelMass, this.mass);
    const c = Math.cos(st.yaw);
    const sn = Math.sin(st.yaw);
    let kerb = false;
    let grass = 0;
    for (let i = 0; i < 4; i++) {
      const bx = i < 2 ? m.a : -m.b;
      const by = st.model.wheelLeft[i]!;
      const x = st.x + bx * c - by * sn;
      const z = st.z - bx * sn - by * c;
      const q = this.track.project(x, z, this.hints[i]!, this.q);
      const kind = this.track.ground(q.s, q.d, this.g).kind;
      if (kind === SurfaceKind.Kerb) kerb = true;
      if (kind === SurfaceKind.Grass || kind === SurfaceKind.Gravel) grass++;
    }
    this.out.kerb = kerb;
    this.out.grass = grass;
    return this.out;
  }
}

/** The last half second of what the car did, for spin reports. */
class History {
  private readonly cols = 12;
  private readonly buf = new Float64Array(HISTORY * 12);
  private count = 0;
  private head = 0;

  push(st: CarState, tcScale: number, kerb: boolean, downshift: boolean): void {
    const curve = st.model.curve;
    let rearSlip = 0;
    let spin = 0;
    let lock = 0;
    let rearAngle = 0;
    let rearLoad = Infinity;
    for (let i = 0; i < 4; i++) {
      const sx = st.slipRatio[i]! / curve.peakSlipRatio;
      const sy = st.slipTan[i]! / curve.peakSlipTan;
      lock = Math.min(lock, st.slipRatio[i]!);
      if (i >= 2) {
        rearSlip = Math.max(rearSlip, Math.hypot(sx, sy));
        spin = Math.max(spin, st.slipRatio[i]!);
        rearAngle = Math.max(rearAngle, Math.abs(Math.atan(st.slipTan[i]!)));
        rearLoad = Math.min(rearLoad, st.load[i]!);
      }
    }
    const o = this.head * this.cols;
    const b = this.buf;
    b[o] = rearSlip;
    b[o + 1] = spin;
    b[o + 2] = lock;
    b[o + 3] = (rearAngle * 180) / Math.PI;
    b[o + 4] = rearLoad;
    b[o + 5] = st.throttleApplied;
    b[o + 6] = st.brakeApplied;
    b[o + 7] = downshift ? 1 : 0;
    b[o + 8] = kerb ? 1 : 0;
    b[o + 9] = st.steerAngle / st.model.params.geometry.maxSteerAngle;
    b[o + 10] = Math.abs(Math.atan2(st.vy, Math.max(Math.abs(st.vx), 1)));
    b[o + 11] = st.vx * 3.6;
    void tcScale;
    this.head = (this.head + 1) % HISTORY;
    this.count = Math.min(this.count + 1, HISTORY);
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }

  summary(): SpinContext {
    const c: SpinContext = {
      slideTime: 0,
      onsetKmh: 0,
      rearSlip: 0,
      wheelspin: 0,
      lock: 0,
      rearSlipAngle: 0,
      rearLoadMin: Infinity,
      throttle: 0,
      brake: 0,
      downshift: false,
      kerb: false,
      steerSwing: 0,
    };
    const b = this.buf;
    const at = (k: number): number => ((this.head - 1 - k + HISTORY) % HISTORY) * this.cols;
    // Walk back to the slide's onset: the last tick with sideslip under the onset angle.
    let onset = 0;
    while (onset < this.count - 1 && b[at(onset) + 10]! >= SLIDE_ONSET) onset++;
    c.slideTime = onset * STEP;
    c.onsetKmh = b[at(onset) + 11]!;
    let steerMin = Infinity;
    let steerMax = -Infinity;
    const end = Math.min(this.count, onset + WINDOW);
    for (let k = onset; k < end; k++) {
      const o = at(k);
      c.rearSlip = Math.max(c.rearSlip, b[o]!);
      c.wheelspin = Math.max(c.wheelspin, b[o + 1]!);
      c.lock = Math.min(c.lock, b[o + 2]!);
      c.rearSlipAngle = Math.max(c.rearSlipAngle, b[o + 3]!);
      c.rearLoadMin = Math.min(c.rearLoadMin, b[o + 4]!);
      c.throttle = Math.max(c.throttle, b[o + 5]!);
      c.brake = Math.max(c.brake, b[o + 6]!);
      c.downshift ||= b[o + 7]! > 0;
      c.kerb ||= b[o + 8]! > 0;
      steerMin = Math.min(steerMin, b[o + 9]!);
      steerMax = Math.max(steerMax, b[o + 9]!);
    }
    c.steerSwing = end > onset ? steerMax - steerMin : 0;
    return c;
  }
}
