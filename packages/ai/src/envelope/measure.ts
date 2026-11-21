import {
  ErsMode,
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  STANDARD_GRAVITY,
  beginErsLap,
  computeMass,
  createCarState,
  createEnvironment,
  gearRatio,
  stepCar,
  type CarParams,
  type CarState,
  type ControlInput,
  type Environment,
  type MassState,
} from '@undercut/sim';
import { lockExcess } from '../driver/feel';
import type { Envelope } from './envelope';
import { optimalShiftRpm } from './shift';

/**
 * Measures the performance envelope by driving the vehicle model through quasi-steady
 * manoeuvres on flat ground at the game's 240 Hz step, the same way the physics validation
 * suite measures its targets: nothing here is typed in that the sim could tell.
 *
 * - Lateral: constant-speed sweeps that tighten the corner by 0.25 g/s until the car will not
 *   take more; the best 0.5 s mean is the sustained limit.
 * - Braking: a threshold stop from above top speed to walking pace, the pedal eased whenever a
 *   wheel passes the tyre's peak slip; deceleration against speed, drag taken out.
 * - Drive: full throttle from low speed to top speed, wheelspin held at the tyre's peak slip,
 *   upshifts at the engine's best shift points; DRS closed and open, MGU-K on and off.
 * - Load: the same lateral, braking and traction runs with gravity scaled, which is what a
 *   crest or a compression does to the tyres while the car's inertia stays the same.
 * - Combined: braking in a held turn at fractions of the lateral limit, for the shape of the
 *   g-g diagram.
 *
 * The rig holds the energy store at half its window and the per-lap ERS counters at zero, so
 * the MGU-K can always deploy and harvest mid-measurement; that changes what is available,
 * never the tyres or the aero.
 */
export interface MeasureConditions {
  params: CarParams;
  airDensity: number;
  fuel: number;
  brakeBias?: number;
}

export interface MeasureOptions {
  /** Speed grid, m/s (uniform). Default 20–380 km/h in 10 km/h steps. */
  speeds?: readonly number[];
  /** Speeds of the lateral sweeps, m/s. Default 60–340 km/h in 20 km/h steps. */
  sweepSpeeds?: readonly number[];
  /** Normal load factors. Default 0.8, 1, 1.2. */
  loads?: readonly number[];
}

const STEP = 1 / 240;
const KMH = 1 / 3.6;
const G0 = STANDARD_GRAVITY;
const DEG = Math.PI / 180;

export const DEFAULT_SPEEDS: readonly number[] = Array.from(
  { length: 37 },
  (_, k) => (20 + 10 * k) * KMH,
);
export const DEFAULT_SWEEP_SPEEDS: readonly number[] = Array.from(
  { length: 15 },
  (_, k) => (60 + 20 * k) * KMH,
);
export const DEFAULT_LOADS: readonly number[] = [0.8, 1, 1.2];

/** One car on flat ground with scaled gravity. */
class Rig {
  readonly car: CarState;
  readonly env: Environment;
  readonly input: ControlInput = { ...NEUTRAL_INPUT };
  readonly mass: MassState = {
    total: 0,
    sprung: 0,
    a: 0,
    b: 0,
    sprungA: 0,
    sprungB: 0,
    yawInertia: 0,
  };
  readonly shiftRpm: number[];
  time = 0;
  constructor(
    readonly cond: MeasureConditions,
    speed: number,
    load: number,
    ersMode: ErsMode,
  ) {
    this.env = createEnvironment({ airDensity: cond.airDensity, gravity: G0 * load });
    this.car = createCarState(cond.params, {
      speed,
      fuel: cond.fuel,
      ersMode,
      airDensity: cond.airDensity,
      ...(cond.brakeBias === undefined ? {} : { brakeBias: cond.brakeBias }),
    });
    this.car.mgukLocked = 0;
    this.shiftRpm = optimalShiftRpm(cond.params);
  }
  get massTotal(): number {
    return computeMass(this.car.model, this.car.fuelMass, this.mass).total;
  }
  step(): void {
    beginErsLap(this.car);
    this.car.ersStore = this.cond.params.ers.storeWindow / 2;
    stepCar(this.car, this.input, FLAT_SURFACE, STEP, this.env);
    this.input.gearShift = 0;
    this.time += STEP;
  }
  rpm(gear: number): number {
    const c = this.car;
    const wheel = (c.wheelSpeed[2]! + c.wheelSpeed[3]!) / 2;
    return (Math.abs(gearRatio(c.model.params, gear) * wheel) * 60) / (2 * Math.PI);
  }
  /** Upshift at the best shift point; downshift while the lower gear stays below its own. */
  shift(downMargin: number): void {
    const c = this.car;
    if (c.shiftTimer > 0 || c.gear < 1) return;
    const top = c.model.params.gearbox.ratios.length;
    if (c.gear < top && this.rpm(c.gear) > this.shiftRpm[c.gear - 1]!) this.input.gearShift = 1;
    else if (c.gear > 1 && this.rpm(c.gear - 1) < this.shiftRpm[c.gear - 2]! - downMargin)
      this.input.gearShift = -1;
  }
}

class Average {
  private readonly buf: Float64Array;
  private i = 0;
  private n = 0;
  private sum = 0;
  constructor(len: number) {
    this.buf = new Float64Array(Math.max(1, Math.round(len)));
  }
  push(v: number): number {
    if (this.n === this.buf.length) this.sum -= this.buf[this.i]!;
    else this.n++;
    this.buf[this.i] = v;
    this.sum += v;
    this.i = (this.i + 1) % this.buf.length;
    return this.sum / this.n;
  }
  get full(): boolean {
    return this.n === this.buf.length;
  }
}

/** PI throttle on speed (brake if far over). */
function holdSpeed(rig: Rig, target: number, state: { integral: number }): void {
  const err = target - rig.car.vx;
  state.integral = Math.min(2, Math.max(-1, state.integral + err * STEP * 0.4));
  const u = 0.6 * err + state.integral;
  rig.input.throttle = Math.min(1, Math.max(0, u));
  rig.input.brake = u < -0.5 ? Math.min(1, -u - 0.5) : 0;
  rig.shift(400);
}

/** Steering to a yaw rate: kinematic feedforward plus PI, gains scaled by 1/speed. */
function steerYawRate(rig: Rig, target: number, state: { integral: number }): void {
  const c = rig.car;
  const p = c.model.params;
  const v = Math.max(c.vx, 5);
  const ff = (p.geometry.wheelbase * target) / v / p.geometry.maxSteerAngle;
  const err = target - c.yawRate;
  state.integral = Math.min(1, Math.max(-1, state.integral + ((20 * err) / v) * STEP));
  rig.input.steer = Math.min(1, Math.max(-1, ff + (4 * err) / v + state.integral));
}

/** Threshold braking: full pedal, eased whenever a loaded wheel passes the peak (`lockExcess`). */
class ThresholdBrake {
  private pedal = 1;
  private applied = 0;
  tick(rig: Rig): void {
    const c = rig.car;
    const target = c.model.params.tyre.peakSlipRatio;
    const excess = lockExcess(c.slipRatio, c.load, target);
    this.applied = Math.min(1, this.applied + STEP / 0.08);
    if (excess > 0) this.pedal -= 400 * excess * STEP;
    else this.pedal += 6 * STEP;
    this.pedal = Math.min(1, Math.max(0, this.pedal));
    rig.input.brake = Math.min(this.applied, this.pedal);
    rig.input.throttle = 0;
  }
}

export interface LateralPoint {
  speed: number;
  lateral: number;
}

/** Sustained lateral limit at one speed and load. */
export function lateralSweep(cond: MeasureConditions, speed: number, load: number): LateralPoint {
  const rig = new Rig(cond, speed, load, ErsMode.Overtake);
  const hold = { integral: 0.3 };
  const steer = { integral: 0 };
  const window = Math.round(0.5 / STEP);
  const ay = new Average(window);
  const vx = new Average(window);
  let target = 0.5 * G0;
  let best = 0;
  let bestV = speed;
  let lagging = 0;
  let overshoot = 0;
  while (rig.time < 60) {
    if (rig.time > 1) target += 0.25 * G0 * STEP;
    const yaw = target / Math.max(rig.car.vx, 1);
    holdSpeed(rig, speed, hold);
    steerYawRate(rig, yaw, steer);
    rig.step();
    const a = ay.push(rig.car.accelY);
    const v = vx.push(rig.car.vx);
    if (ay.full && a > best) {
      best = a;
      bestV = v;
    }
    const beta = Math.atan2(rig.car.vy, Math.max(rig.car.vx, 1));
    overshoot = rig.car.yawRate > yaw * 1.3 ? overshoot + 1 : 0;
    if (Math.abs(beta) > 6 * DEG || overshoot * STEP > 0.2) break;
    lagging = rig.car.accelY < target - 0.3 * G0 ? lagging + 1 : 0;
    if (lagging * STEP > 0.75) break;
    if (target > 8 * G0) break;
  }
  return { speed: bestV, lateral: best };
}

export interface BrakingCurve {
  speed: number[];
  /** Total deceleration, drag share, and MGU-K harvest power, per recorded tick. */
  decel: number[];
  drag: number[];
  harvest: number[];
}

/** A threshold stop from `from` down to `to`, recorded tick by tick after the pedal settles. */
export function brakingCurve(
  cond: MeasureConditions,
  load: number,
  from = 390 * KMH,
  to = 30 * KMH,
): BrakingCurve {
  const rig = new Rig(cond, from, load, ErsMode.None);
  const driver = new ThresholdBrake();
  const ma = new Average(Math.round(0.05 / STEP));
  const out: BrakingCurve = { speed: [], decel: [], drag: [], harvest: [] };
  // Let the suspension settle under this gravity before the stop.
  const hold = { integral: 1 };
  while (rig.time < 0.4) {
    holdSpeed(rig, from, hold);
    rig.step();
  }
  const t0 = rig.time;
  while (rig.car.vx > to && rig.time < t0 + 30) {
    driver.tick(rig);
    rig.shift(1500);
    rig.step();
    const d = ma.push(-rig.car.accelX);
    if (rig.time - t0 < 0.25) continue;
    const m = rig.massTotal;
    out.speed.push(rig.car.vx);
    out.decel.push(d);
    out.drag.push(rig.car.dragForce / m);
    out.harvest.push(Math.max(0, -rig.car.mgukPower));
  }
  return out;
}

export interface DriveCurve {
  speed: number[];
  /** Net acceleration (drag included), the tyre share (drag added back), throttle, MGU-H. */
  accel: number[];
  tyre: number[];
  throttle: number[];
  drag: number[];
  mguh: number[];
  topSpeed: number;
}

/** Full throttle from low speed to top speed, wheelspin held at the tyre's peak slip. */
export function driveCurve(
  cond: MeasureConditions,
  load: number,
  drs: boolean,
  ers: boolean,
  from = 40 * KMH,
): DriveCurve {
  const rig = new Rig(cond, from, load, ers ? ErsMode.Overtake : ErsMode.None);
  const R = cond.params.tyre.rollingRadius;
  const target = cond.params.tyre.peakSlipRatio;
  const ma = new Average(Math.round(0.05 / STEP));
  const out: DriveCurve = {
    speed: [],
    accel: [],
    tyre: [],
    throttle: [],
    drag: [],
    mguh: [],
    topSpeed: 0,
  };
  let throttle = 0.6;
  let sinceShift = 0;
  let slowFor = 0;
  rig.input.drs = drs;
  while (rig.time < 90) {
    const c = rig.car;
    const v = Math.max(c.vx, 0);
    const slipSpeed = ((c.wheelSpeed[2]! + c.wheelSpeed[3]!) / 2) * R - c.vx;
    const want = Math.max(target * v, 1);
    throttle = Math.min(1, Math.max(0.05, throttle + 8 * ((want - slipSpeed) / (want + 1)) * STEP));
    rig.input.throttle = throttle;
    rig.input.brake = 0;
    rig.shift(1e9);
    rig.step();
    const a = ma.push(c.accelX);
    sinceShift = c.shiftTimer > 0 ? 0 : sinceShift + STEP;
    out.topSpeed = Math.max(out.topSpeed, c.vx);
    if (rig.time < 0.3 || sinceShift < 0.1) continue;
    const m = rig.massTotal;
    out.speed.push(c.vx);
    out.accel.push(a);
    out.tyre.push(a + c.dragForce / m);
    out.throttle.push(c.throttleApplied);
    out.drag.push(c.dragForce / m);
    out.mguh.push(c.mguhPower);
    slowFor = a < 0.02 ? slowFor + STEP : 0;
    if (slowFor > 1) break;
  }
  return out;
}

export interface CombinedPoint {
  speed: number;
  /** Lateral used, as a fraction of the pure lateral limit. */
  lateralFraction: number;
  /** Tyre braking reached, as a fraction of the pure braking limit at the same speed. */
  brakeFraction: number;
}

/**
 * Braking in a held turn: settle at `fraction` of the lateral limit, then brake at the
 * threshold while steering keeps the same fraction of the (falling) lateral limit. The mean
 * tyre deceleration over the first half second, against the straight-line value, gives one
 * point of the combined limit.
 */
export function combinedPoint(
  cond: MeasureConditions,
  speed: number,
  fraction: number,
  lateralAt: (v: number) => number,
  brakeAt: (v: number) => number,
): CombinedPoint {
  const rig = new Rig(cond, speed, 1, ErsMode.Overtake);
  const hold = { integral: 0.3 };
  const steer = { integral: 0 };
  while (rig.time < 2.5) {
    const ay = fraction * lateralAt(rig.car.vx) * Math.min(1, rig.time / 1.5);
    holdSpeed(rig, speed, hold);
    steerYawRate(rig, ay / Math.max(rig.car.vx, 1), steer);
    rig.step();
  }
  const driver = new ThresholdBrake();
  const t0 = rig.time;
  let sumBrake = 0;
  let sumPure = 0;
  let sumLat = 0;
  let sumLatPure = 0;
  let count = 0;
  while (rig.time < t0 + 0.65) {
    const ay = fraction * lateralAt(rig.car.vx);
    driver.tick(rig);
    steerYawRate(rig, ay / Math.max(rig.car.vx, 1), steer);
    rig.step();
    if (rig.time - t0 < 0.15) continue;
    const m = rig.massTotal;
    sumBrake += -rig.car.accelX - rig.car.dragForce / m;
    sumPure += brakeAt(rig.car.vx);
    sumLat += Math.abs(rig.car.accelY);
    sumLatPure += lateralAt(rig.car.vx);
    count++;
  }
  if (count === 0) throw new Error('combined measurement recorded nothing');
  return { speed, lateralFraction: sumLat / sumLatPure, brakeFraction: sumBrake / sumPure };
}

/**
 * Linear interpolation of scattered (x, y) onto `grid`. Past the highest x it extrapolates the
 * least-squares line through the top `tail` points, in `xf(x)` space; below the lowest x it
 * extends the first segment.
 */
export function resample(
  xs: readonly number[],
  ys: readonly number[],
  grid: readonly number[],
  xf: (x: number) => number = (x) => x,
  tail = 4,
): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!);
  const X = order.map((i) => xf(xs[i]!));
  const Y = order.map((i) => ys[i]!);
  const m = X.length;
  const k = Math.min(tail, m);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let j = m - k; j < m; j++) {
    sx += X[j]!;
    sy += Y[j]!;
    sxx += X[j]! * X[j]!;
    sxy += X[j]! * Y[j]!;
  }
  const den = k * sxx - sx * sx;
  const slope = den > 0 ? (k * sxy - sx * sy) / den : 0;
  const icept = (sy - slope * sx) / k;
  return grid.map((g) => {
    const x = xf(g);
    if (x > X[m - 1]!) return icept + slope * x;
    let j = 0;
    while (j < m - 2 && x > X[j + 1]!) j++;
    const x0 = X[j]!;
    const x1 = X[j + 1]!;
    const w = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
    return Y[j]! + (Y[j + 1]! - Y[j]!) * w;
  });
}

/** Three-point moving average that skips NaN entries. */
export function smooth3(values: readonly number[]): number[] {
  return values.map((v, i) => {
    if (!Number.isFinite(v)) return v;
    let sum = 2 * v;
    let w = 2;
    for (const j of [i - 1, i + 1]) {
      const u = values[j];
      if (u !== undefined && Number.isFinite(u)) {
        sum += u;
        w += 1;
      }
    }
    return sum / w;
  });
}

/** Mean of `values` binned onto `grid` (bins half a grid step either side); empty bins NaN. */
export function binMean(
  xs: readonly number[],
  values: readonly number[],
  grid: readonly number[],
): number[] {
  const half = (grid[1]! - grid[0]!) / 2;
  const sum = new Float64Array(grid.length);
  const cnt = new Float64Array(grid.length);
  const g0 = grid[0]!;
  for (let i = 0; i < xs.length; i++) {
    const k = Math.round((xs[i]! - g0) / (2 * half));
    if (k < 0 || k >= grid.length) continue;
    sum[k] = sum[k]! + values[i]!;
    cnt[k] = cnt[k]! + 1;
  }
  return Array.from(sum, (s, k) => (cnt[k]! > 0 ? s / cnt[k]! : Number.NaN));
}

/** Fill NaN gaps by linear interpolation and edge extrapolation (in `xf` space). */
export function fillGaps(
  grid: readonly number[],
  values: readonly number[],
  xf: (x: number) => number = (x) => x,
): number[] {
  const xs: number[] = [];
  const ys: number[] = [];
  values.forEach((v, i) => {
    if (Number.isFinite(v)) {
      xs.push(grid[i]!);
      ys.push(v);
    }
  });
  if (xs.length < 2) throw new Error('too few measured points to fill a table');
  const filled = resample(xs, ys, grid, xf);
  return values.map((v, i) => (Number.isFinite(v) ? v : filled[i]!));
}

/** Solve f^p + b^p = 1 for p in [1, 6] by bisection. */
function exponentFor(f: number, b: number): number {
  if (!(f > 0 && f < 1 && b > 0 && b < 1)) return Number.NaN;
  let lo = 1;
  let hi = 6;
  for (let k = 0; k < 60; k++) {
    const p = 0.5 * (lo + hi);
    // f^p + b^p falls as p grows.
    if (Math.pow(f, p) + Math.pow(b, p) > 1) lo = p;
    else hi = p;
  }
  return 0.5 * (lo + hi);
}

export interface MeasureReport {
  envelope: Envelope;
  lateralPoints: { load: number; points: LateralPoint[] }[];
  combinedPoints: CombinedPoint[];
  /** Sim seconds driven to measure it. */
  simSeconds: number;
}

/** Measure the whole envelope. Deterministic; takes a few seconds of wall time. */
export function measureEnvelope(
  cond: MeasureConditions,
  options: MeasureOptions = {},
): MeasureReport {
  const speeds = options.speeds ?? DEFAULT_SPEEDS;
  const sweeps = options.sweepSpeeds ?? DEFAULT_SWEEP_SPEEDS;
  const loads = options.loads ?? DEFAULT_LOADS;
  const sq = (v: number): number => v * v;
  let simSeconds = 0;

  const lateralPoints: MeasureReport['lateralPoints'] = [];
  const lateral = loads.map((load) => {
    const all = sweeps.map((v) => lateralSweep(cond, v, load));
    lateralPoints.push({ load, points: all });
    simSeconds += all.length * 20;
    // A sweep that could not hold its speed (power runs out at the top end) is not used.
    const points = all.filter((p, i) => p.speed > 0.97 * sweeps[i]!);
    // Lateral grip grows with downforce, so extrapolate linearly in v².
    return resample(
      points.map((p) => p.speed),
      points.map((p) => p.lateral),
      speeds,
      sq,
    );
  });

  const brakeRuns = loads.map((load) => brakingCurve(cond, load));
  const brake = brakeRuns.map((run) => {
    simSeconds += run.speed.length * STEP;
    const tyre = run.decel.map((d, i) => d - run.drag[i]!);
    return fillGaps(speeds, smooth3(binMean(run.speed, tyre, speeds)), sq);
  });
  const ref = loads.indexOf(1) >= 0 ? loads.indexOf(1) : Math.floor(loads.length / 2);
  const harvest = fillGaps(
    speeds,
    smooth3(binMean(brakeRuns[ref]!.speed, brakeRuns[ref]!.harvest, speeds)),
  );

  const drives = {
    closedErs: driveCurve(cond, 1, false, true),
    closedNoErs: driveCurve(cond, 1, false, false),
    openErs: driveCurve(cond, 1, true, true),
    openNoErs: driveCurve(cond, 1, true, false),
  };
  for (const d of Object.values(drives)) simSeconds += d.speed.length * STEP;
  const driveTable = (d: DriveCurve): number[] => {
    const binned = binMean(d.speed, d.accel, speeds);
    // Past top speed the car decelerates: extrapolate from the measured top end.
    return fillGaps(speeds, binned);
  };
  const dragClosed = fillGaps(
    speeds,
    binMean(drives.closedErs.speed, drives.closedErs.drag, speeds),
    sq,
  );
  const dragOpen = fillGaps(speeds, binMean(drives.openErs.speed, drives.openErs.drag, speeds), sq);
  const mguh = fillGaps(speeds, binMean(drives.closedErs.speed, drives.closedErs.mguh, speeds));

  // Traction: where the driver held the throttle below full, the run was traction-limited.
  // Above that the run is power-limited, and the traction limit follows the braking limit's
  // growth with speed (both scale with the load on the tyres).
  const traction = loads
    .map((load, li) => {
      const run = load === 1 ? drives.closedErs : driveCurve(cond, load, false, true);
      if (load !== 1) simSeconds += run.speed.length * STEP;
      const limited = run.speed.map((_, i) => run.throttle[i]! < 0.97);
      const tyre = binMean(
        run.speed.filter((_, i) => limited[i]),
        run.tyre.filter((_, i) => limited[i]),
        speeds,
      );
      let last = -1;
      for (let k = 0; k < speeds.length; k++) if (Number.isFinite(tyre[k]!)) last = k;
      if (last < 0) throw new Error('drive run was never traction-limited');
      const b = brake[li]!;
      return speeds.map((_, k) => {
        if (k <= last && Number.isFinite(tyre[k]!)) return tyre[k]!;
        if (k < last) return Number.NaN;
        return (tyre[last]! * b[k]!) / b[last]!;
      });
    })
    .map((t) => fillGaps(speeds, smooth3(t)));

  const interp = (table: readonly number[]) => (v: number) => {
    const u = Math.min(
      Math.max((v - speeds[0]!) / (speeds[1]! - speeds[0]!), 0),
      speeds.length - 1.001,
    );
    const i = Math.floor(u);
    return table[i]! + (table[i + 1]! - table[i]!) * (u - i);
  };
  const combinedPoints: CombinedPoint[] = [];
  for (const v of [120 * KMH, 200 * KMH, 280 * KMH]) {
    for (const f of [0.5, 0.75]) {
      combinedPoints.push(combinedPoint(cond, v, f, interp(lateral[ref]!), interp(brake[ref]!)));
      simSeconds += 3.2;
    }
  }
  const exps = combinedPoints
    .map((p) => exponentFor(p.lateralFraction, p.brakeFraction))
    .filter((p) => Number.isFinite(p))
    .sort((a, b) => a - b);
  if (exps.length === 0) throw new Error('no usable combined-limit measurement');
  const combinedExponent = exps[Math.floor(exps.length / 2)]!;

  const mass = cond.params.mass.dryMass + cond.fuel;
  const round = (a: readonly number[]): number[] => a.map((x) => Number(x.toPrecision(5)));
  const envelope: Envelope = {
    format: 'undercut-envelope',
    version: 1,
    conditions: {
      trim: cond.params.aero.name,
      airDensity: cond.airDensity,
      fuel: cond.fuel,
      mass,
      brakeBias: cond.brakeBias ?? cond.params.brakes.bias,
    },
    speeds: speeds.map((v) => Number(v.toFixed(6))),
    loads: [...loads],
    lateral: lateral.map(round),
    brake: brake.map(round),
    traction: traction.map(round),
    drive: {
      closedErs: round(driveTable(drives.closedErs)),
      closedNoErs: round(driveTable(drives.closedNoErs)),
      openErs: round(driveTable(drives.openErs)),
      openNoErs: round(driveTable(drives.openNoErs)),
    },
    drag: { closed: round(dragClosed), open: round(dragOpen) },
    combinedExponent: Number(combinedExponent.toPrecision(4)),
    mguh: round(mguh),
    harvest: round(harvest),
    ers: {
      mgukPower: cond.params.ers.mgukPower,
      deployPerLap: cond.params.ers.deployPerLap,
      harvestPerLap: cond.params.ers.harvestPerLap,
      storeWindow: cond.params.ers.storeWindow,
    },
    shiftRpm: optimalShiftRpm(cond.params),
    topSpeed: {
      closed: Number(drives.closedErs.topSpeed.toPrecision(5)),
      open: Number(drives.openErs.topSpeed.toPrecision(5)),
    },
  };
  return { envelope, lateralPoints, combinedPoints, simSeconds };
}
