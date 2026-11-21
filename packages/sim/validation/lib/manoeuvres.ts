import {
  ErsMode,
  NEUTRAL_INPUT,
  applyAssists,
  createAssistState,
  type AeroTrim,
  type AssistSettings,
  type CarParams,
  type ControlInput,
} from '../../src/index';
import {
  LaunchDriver,
  SpeedHold,
  ThresholdBrakeDriver,
  YawRateSteer,
  shiftForSpeed,
  trailOffCap,
} from './drivers';
import {
  CIRCUITS,
  G,
  Harness,
  KMH,
  MovingAverage,
  STEP,
  type Circuit,
  type Trace,
} from './harness';

/** Window for "peak" decelerations: 50 ms moving average (doc 2.4 test 1). */
const PEAK_WINDOW = Math.round(0.05 / STEP);
/** Window for sustained lateral acceleration: 0.5 s (doc 2.5). */
const SUSTAIN_WINDOW = Math.round(0.5 / STEP);
const DEG = Math.PI / 180;

export interface RunOptions {
  record?: boolean;
  /** Car parameters to use instead of the reference car in the manoeuvre's trim. */
  params?: CarParams;
}

function harnessRecord(o: RunOptions): number {
  return o.record ? 6 : 0; // 40 Hz traces
}

function paramsOf(o: RunOptions): { params?: CarParams } {
  return o.params ? { params: o.params } : {};
}

// ---------------------------------------------------------------------------------------------
// Standing start (doc 2.3): flat asphalt, race fuel 105 kg, no launch control, best of 5.

export interface StandingStartResult {
  slipTarget: number;
  t100: number;
  t200: number;
  t300: number;
  trace?: Trace;
}

export function standingStart(
  o: RunOptions & { trim?: AeroTrim; slipTarget?: number; fuel?: number } = {},
): StandingStartResult {
  const slipTarget = o.slipTarget ?? 0.1;
  const h = new Harness({
    trim: o.trim ?? 'medium',
    fuel: o.fuel ?? 105,
    ersMode: ErsMode.Overtake,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  const driver = new LaunchDriver(slipTarget);
  const marks = [100 * KMH, 200 * KMH, 300 * KMH];
  const times = [NaN, NaN, NaN];
  let next = 0;
  while (h.time < 40 && next < 3) {
    driver.tick(h);
    h.step();
    while (next < 3 && h.car.vx >= marks[next]!) times[next++] = h.time;
  }
  const r: StandingStartResult = { slipTarget, t100: times[0]!, t200: times[1]!, t300: times[2]! };
  if (h.trace) r.trace = h.trace;
  return r;
}

/** Five launches at different wheelspin targets; the run with the best 0–100 counts. */
export const LAUNCH_SLIP_TARGETS = [0.06, 0.08, 0.1, 0.12, 0.14] as const;

export function bestStandingStart(o: RunOptions & { trim?: AeroTrim } = {}): StandingStartResult {
  let best: StandingStartResult | undefined;
  for (const slipTarget of LAUNCH_SLIP_TARGETS) {
    const r = standingStart({ ...o, slipTarget, record: false });
    if (!best || r.t100 < best.t100) best = r;
  }
  return o.record ? standingStart({ ...o, slipTarget: best!.slipTarget }) : best!;
}

// ---------------------------------------------------------------------------------------------
// Top speed (doc 2.2): long flat straight, DRS open, MGU-K deploying, qualifying fuel.

export interface TopSpeedResult {
  trim: AeroTrim;
  drs: boolean;
  maxSpeed: number;
  /** Time from the 200 km/h rolling start to within 1 km/h of the maximum. */
  timeToMax: number;
  deployUsed: number;
  trace?: Trace;
}

export function topSpeed(
  o: RunOptions & { trim?: AeroTrim; drs?: boolean; airDensity?: number; fuel?: number } = {},
): TopSpeedResult {
  const trim = o.trim ?? 'low';
  const drs = o.drs ?? true;
  const h = new Harness({
    trim,
    fuel: o.fuel ?? 10,
    speed: 200 * KMH,
    ersMode: ErsMode.Overtake,
    airDensity: o.airDensity ?? CIRCUITS.monza.airDensity,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  h.input.drs = drs;
  let max = 0;
  let maxAt = 0;
  const speeds: number[] = [];
  while (h.time < 60) {
    h.input.throttle = 1;
    shiftForSpeed(h, false);
    h.step();
    speeds.push(h.car.vx);
    if (h.car.vx > max) {
      max = h.car.vx;
      maxAt = h.time;
    }
    if (h.time - maxAt > 5) break;
  }
  let reach = maxAt;
  for (let i = 0; i < speeds.length; i++) {
    if (speeds[i]! >= max - 1 * KMH) {
      reach = (i + 1) * STEP;
      break;
    }
  }
  const r: TopSpeedResult = {
    trim,
    drs,
    maxSpeed: max,
    timeToMax: reach,
    deployUsed: h.car.ersDeployLap,
  };
  if (h.trace) r.trace = h.trace;
  return r;
}

// ---------------------------------------------------------------------------------------------
// Straight-line braking (doc 2.4 test 1): circuit trim, race fuel 50 kg, threshold braking
// without ABS, best brake bias in the driver-adjustable range.

export interface BrakingResult {
  circuit: Circuit;
  v1: number;
  v2: number;
  bias: number;
  distance: number;
  time: number;
  peakG: number;
  meanG: number;
  trace?: Trace;
}

export const BIAS_RANGE = [0.52, 0.54, 0.56, 0.58, 0.6, 0.62] as const;

export function braking(
  o: RunOptions & {
    circuit: Circuit;
    v1: number;
    v2: number;
    bias: number;
    fuel?: number;
    /** 'event' (default) trails off into the corner; 'threshold' brakes flat out to v2. */
    profile?: 'event' | 'threshold';
  },
): BrakingResult {
  const c = CIRCUITS[o.circuit];
  const h = new Harness({
    trim: c.trim,
    fuel: o.fuel ?? 50,
    speed: o.v1,
    airDensity: c.airDensity,
    brakeBias: o.bias,
    // Every published event ends a DRS straight with the MGU-K deploying; the store is
    // part-used by then, so the MGU-K can harvest under the brakes.
    ersMode: ErsMode.Overtake,
    ersStore: 2e6,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  // Settle the suspension under the aero load while holding v1 with the throttle, DRS open,
  // then brake on the first tick that is within 0.05 km/h of v1.
  h.input.drs = true;
  const hold = new SpeedHold(o.v1, 2, 4, 0.8);
  while (h.time < 0.5 || Math.abs(h.car.vx - o.v1) > 0.05 * KMH) {
    if (h.time > 5) throw new Error(`cannot hold ${(o.v1 / KMH).toFixed(1)} km/h to brake from it`);
    hold.tick(h);
    h.step();
  }
  const startDistance = h.car.distance;
  const startTime = h.time;
  const startSpeed = h.car.vx;
  const driver = new ThresholdBrakeDriver();
  if ((o.profile ?? 'event') === 'event') driver.cap = (v) => trailOffCap(v, o.v1, o.v2);
  const ma = new MovingAverage(PEAK_WINDOW);
  let peak = 0;
  let prevSpeed = startSpeed;
  let prevDistance = startDistance;
  let prevTime = startTime;
  while (h.car.vx > o.v2 && h.time - startTime < 10) {
    prevSpeed = h.car.vx;
    prevDistance = h.car.distance;
    prevTime = h.time;
    driver.tick(h);
    h.step();
    const avg = ma.push(-h.tel.longG);
    if (ma.full && avg > peak) peak = avg;
  }
  // Interpolate the crossing of v2 inside the last step.
  const f = prevSpeed > h.car.vx ? (prevSpeed - o.v2) / (prevSpeed - h.car.vx) : 1;
  const distance = prevDistance + f * (h.car.distance - prevDistance) - startDistance;
  const r: BrakingResult = {
    circuit: o.circuit,
    v1: startSpeed,
    v2: o.v2,
    bias: o.bias,
    distance,
    time: prevTime + f * (h.time - prevTime) - startTime,
    peakG: peak,
    meanG: (startSpeed * startSpeed - o.v2 * o.v2) / (2 * distance) / G,
  };
  if (h.trace) r.trace = h.trace;
  return r;
}

/** The braking run with the shortest distance over the bias range. */
export function bestBraking(
  o: RunOptions & { circuit: Circuit; v1: number; v2: number; fuel?: number },
): BrakingResult {
  let best: BrakingResult | undefined;
  for (const bias of BIAS_RANGE) {
    const r = braking({ ...o, bias, record: false });
    if (!best || r.distance < best.distance) best = r;
  }
  return o.record ? braking({ ...o, bias: best!.bias }) : best!;
}

/** Peak (50 ms) deceleration when braking from `speed` in Monza trim (doc 2.4 test 2). */
export function peakDeceleration(speed: number, circuit: Circuit = 'monza'): number {
  let best = 0;
  for (const bias of BIAS_RANGE) {
    const r = braking({
      circuit,
      v1: speed,
      v2: Math.max(speed - 60 * KMH, 20 * KMH),
      bias,
      profile: 'threshold',
    });
    best = Math.max(best, r.peakG);
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Sustained lateral acceleration (doc 2.5): constant speed, the driver tightens the corner
// slowly (yaw-rate target rising 0.25 g/s) until the car will not take more.

export interface LateralResult {
  trim: AeroTrim;
  speed: number;
  maxLatG: number;
  /** Why the sweep stopped: front or rear saturation, or the target ran out. */
  limit: 'understeer' | 'oversteer' | 'target';
  trace?: Trace;
}

export function lateralLimit(
  o: RunOptions & { trim: AeroTrim; speed: number; airDensity?: number; fuel?: number },
): LateralResult {
  const h = new Harness({
    trim: o.trim,
    fuel: o.fuel ?? 10,
    speed: o.speed,
    airDensity: o.airDensity ?? 1.184,
    ersMode: ErsMode.None,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  const hold = new SpeedHold(o.speed);
  const steer = new YawRateSteer(0);
  const ma = new MovingAverage(SUSTAIN_WINDOW);
  let target = 0.5 * G;
  let best = 0;
  let limit: LateralResult['limit'] = 'target';
  let lagging = 0;
  let overshoot = 0;
  while (h.time < 60) {
    if (h.time > 1) target += 0.25 * G * STEP;
    steer.targetYawRate = target / Math.max(h.car.vx, 1);
    hold.tick(h);
    steer.tick(h);
    h.step();
    const avg = ma.push(h.tel.latG);
    if (ma.full && avg > best) best = avg;
    const beta = Math.atan2(h.car.vy, Math.max(h.car.vx, 1));
    overshoot = h.car.yawRate > steer.targetYawRate * 1.3 ? overshoot + 1 : 0;
    if (Math.abs(beta) > 6 * DEG || overshoot * STEP > 0.2) {
      limit = 'oversteer';
      break;
    }
    lagging = h.tel.latG * G < target - 0.3 * G ? lagging + 1 : 0;
    if (lagging * STEP > 0.75) {
      limit = 'understeer';
      break;
    }
    if (target > 8 * G) break;
  }
  const r: LateralResult = { trim: o.trim, speed: o.speed, maxLatG: best, limit };
  if (h.trace) r.trace = h.trace;
  return r;
}

// ---------------------------------------------------------------------------------------------
// Handling checks.

export interface StepSteerResult {
  speed: number;
  steer: number;
  steadyYawRate: number;
  steadyLatG: number;
  /** 10 %–90 % yaw-rate rise time, s. */
  riseTime: number;
  /** Peak yaw rate above the steady value, as a fraction. */
  overshoot: number;
  maxSideslipDeg: number;
  trace?: Trace;
}

/** Step steer at constant throttle-held speed: the yaw response must settle (stability). */
export function stepSteer(
  o: RunOptions & { trim?: AeroTrim; speed?: number; steer?: number } = {},
): StepSteerResult {
  const speed = o.speed ?? 150 * KMH;
  const steerIn = o.steer ?? 0.12;
  const h = new Harness({
    trim: o.trim ?? 'medium',
    fuel: 50,
    speed,
    ersMode: ErsMode.None,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  const hold = new SpeedHold(speed);
  const rates: number[] = [];
  let maxBeta = 0;
  const t0 = 1;
  while (h.time < t0 + 4) {
    hold.tick(h);
    h.input.steer = h.time >= t0 ? steerIn : 0;
    h.step();
    if (h.time >= t0) rates.push(h.car.yawRate);
    maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(h.car.vy, Math.max(h.car.vx, 1))));
  }
  const tail = rates.slice(-Math.round(1 / STEP));
  const steady = tail.reduce((a, b) => a + b, 0) / tail.length;
  let t10 = NaN;
  let t90 = NaN;
  let peak = 0;
  rates.forEach((r, i) => {
    if (Number.isNaN(t10) && r >= 0.1 * steady) t10 = i * STEP;
    if (Number.isNaN(t90) && r >= 0.9 * steady) t90 = i * STEP;
    peak = Math.max(peak, r);
  });
  const r: StepSteerResult = {
    speed,
    steer: steerIn,
    steadyYawRate: steady,
    steadyLatG: (steady * h.car.vx) / G,
    riseTime: t90 - t10,
    overshoot: peak / steady - 1,
    maxSideslipDeg: maxBeta / DEG,
  };
  if (h.trace) r.trace = h.trace;
  return r;
}

export interface LiftOffResult {
  speed: number;
  latG: number;
  /** Largest yaw-rate rise after the lift, as a fraction of the yaw rate before it. */
  yawRateRise: number;
  maxSideslipDeg: number;
  spun: boolean;
  trace?: Trace;
}

/**
 * Lift-off in a steady corner: hold a corner at `fraction` of the limit, then snap the throttle
 * shut with the wheel held still. The car may tighten its line, but must not spin.
 */
export function liftOffInCorner(
  o: RunOptions & { trim?: AeroTrim; speed?: number; latG?: number } = {},
): LiftOffResult {
  const speed = o.speed ?? 150 * KMH;
  const latG = o.latG ?? 2.4;
  const h = new Harness({
    trim: o.trim ?? 'medium',
    fuel: 50,
    speed,
    ersMode: ErsMode.None,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  const hold = new SpeedHold(speed);
  const steer = new YawRateSteer((latG * G) / speed);
  while (h.time < 3) {
    hold.tick(h);
    steer.tick(h);
    h.step();
  }
  const before = h.car.yawRate;
  const held = h.input.steer;
  let peak = before;
  let maxBeta = 0;
  while (h.time < 5) {
    h.input.throttle = 0;
    h.input.brake = 0;
    h.input.steer = held;
    h.step();
    peak = Math.max(peak, h.car.yawRate);
    maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(h.car.vy, Math.max(Math.abs(h.car.vx), 1))));
  }
  const r: LiftOffResult = {
    speed,
    latG,
    yawRateRise: peak / before - 1,
    maxSideslipDeg: maxBeta / DEG,
    spun: maxBeta > 20 * DEG,
  };
  if (h.trace) r.trace = h.trace;
  return r;
}

export interface CoastDownResult {
  /** Deceleration in g at 300, 250, 200, 150 and 100 km/h, in neutral with no input. */
  speeds: number[];
  decelG: number[];
  trace?: Trace;
}

export function coastDown(o: RunOptions & { trim?: AeroTrim } = {}): CoastDownResult {
  const h = new Harness({
    trim: o.trim ?? 'medium',
    fuel: 50,
    speed: 320 * KMH,
    gear: 0,
    ersMode: ErsMode.None,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  const speeds = [300, 250, 200, 150, 100];
  const decel: number[] = [];
  const ma = new MovingAverage(Math.round(0.2 / STEP));
  let k = 0;
  while (h.time < 120 && k < speeds.length) {
    h.input.throttle = 0;
    h.step();
    const avg = ma.push(-h.tel.longG);
    if (h.car.vx <= speeds[k]! * KMH) {
      decel.push(avg);
      k++;
    }
  }
  const r: CoastDownResult = { speeds, decelG: decel };
  if (h.trace) r.trace = h.trace;
  return r;
}

// ---------------------------------------------------------------------------------------------
// Assist sanity: what a keyboard driver does at the limit.

export interface AssistCheckResult {
  label: string;
  maxRearSlip: number;
  minSlip: number;
  maxSideslipDeg: number;
  spun: boolean;
  /** Speed after the manoeuvre, km/h. */
  endSpeedKmh: number;
  trace?: Trace;
}

function assistRun(
  h: Harness,
  settings: AssistSettings,
  driver: ControlInput,
  memory = createAssistState(),
): void {
  applyAssists(settings, memory, h.car, driver, STEP, h.input);
}

/** Assist checks start from a corner at this share of the car's own lateral limit. */
export const ASSIST_CORNER_FRACTION = 0.85;

/** Sustained lateral limit in g for the assist checks' car and speed (50 kg fuel). */
function limitAt(o: RunOptions, trim: AeroTrim, speed: number): number {
  return lateralLimit({ ...paramsOf(o), trim, speed, fuel: 50 }).maxLatG;
}

/**
 * Full throttle out of a slow corner (80 km/h, at 85 % of the car's lateral limit there) with
 * the wheel held still, with and without traction control.
 */
export function throttleOutOfSlowCorner(
  o: RunOptions & { tractionControl: number },
): AssistCheckResult {
  const speed = 80 * KMH;
  const latG = ASSIST_CORNER_FRACTION * limitAt(o, 'high', speed);
  const h = new Harness({
    trim: 'high',
    fuel: 50,
    speed,
    ersMode: ErsMode.Balanced,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  const hold = new SpeedHold(speed);
  const steer = new YawRateSteer((latG * G) / speed);
  while (h.time < 2) {
    hold.tick(h);
    steer.tick(h);
    h.step();
  }
  const driver: ControlInput = { ...NEUTRAL_INPUT, steer: h.input.steer, throttle: 1 };
  const settings = { tractionControl: o.tractionControl, abs: 0, autoGears: true };
  const memory = createAssistState();
  let maxRear = 0;
  let maxBeta = 0;
  while (h.time < 4) {
    assistRun(h, settings, driver, memory);
    h.step();
    maxRear = Math.max(maxRear, h.car.slipRatio[2]!, h.car.slipRatio[3]!);
    maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(h.car.vy, Math.max(Math.abs(h.car.vx), 1))));
  }
  const r: AssistCheckResult = {
    label: `throttle exit, TC ${o.tractionControl}`,
    maxRearSlip: maxRear,
    minSlip: 0,
    maxSideslipDeg: maxBeta / DEG,
    spun: maxBeta > 20 * DEG,
    endSpeedKmh: h.car.vx * 3.6,
  };
  if (h.trace) r.trace = h.trace;
  return r;
}

/**
 * Full brake while turning (200 km/h, at 85 % of the car's lateral limit there) with the wheel
 * held, with and without ABS.
 */
export function brakeWhileTurning(o: RunOptions & { abs: number }): AssistCheckResult {
  const speed = 200 * KMH;
  const latG = ASSIST_CORNER_FRACTION * limitAt(o, 'medium', speed);
  const h = new Harness({
    trim: 'medium',
    fuel: 50,
    speed,
    ersMode: ErsMode.Balanced,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  const hold = new SpeedHold(speed);
  const steer = new YawRateSteer((latG * G) / speed);
  while (h.time < 2) {
    hold.tick(h);
    steer.tick(h);
    h.step();
  }
  const driver: ControlInput = { ...NEUTRAL_INPUT, steer: h.input.steer, brake: 1 };
  const settings = { tractionControl: 0, abs: o.abs, autoGears: true };
  const memory = createAssistState();
  let minSlip = 0;
  let maxBeta = 0;
  while (h.time < 5 && h.car.vx > 60 * KMH) {
    assistRun(h, settings, driver, memory);
    h.step();
    for (let i = 0; i < 4; i++) minSlip = Math.min(minSlip, h.car.slipRatio[i]!);
    maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(h.car.vy, Math.max(Math.abs(h.car.vx), 1))));
  }
  const r: AssistCheckResult = {
    label: `brake in turn, ABS ${o.abs}`,
    maxRearSlip: 0,
    minSlip,
    maxSideslipDeg: maxBeta / DEG,
    spun: maxBeta > 20 * DEG,
    endSpeedKmh: h.car.vx * 3.6,
  };
  if (h.trace) r.trace = h.trace;
  return r;
}

export interface AbsStopResult {
  abs: number;
  minSlip: number;
  distance: number;
  spun: boolean;
  trace?: Trace;
}

/** Full pedal in a straight line from 300 to 100 km/h, high-downforce trim, with ABS 0–3. */
export function absStraightStop(o: RunOptions & { abs: number }): AbsStopResult {
  const h = new Harness({
    trim: 'high',
    fuel: 50,
    speed: 300 * KMH,
    ersMode: ErsMode.Balanced,
    ersStore: 2e6,
    recordEvery: harnessRecord(o),
    ...paramsOf(o),
  });
  const hold = new SpeedHold(300 * KMH, 2, 4, 0.9);
  while (h.time < 0.5) {
    hold.tick(h);
    h.step();
  }
  const driver: ControlInput = { ...NEUTRAL_INPUT, brake: 1 };
  const settings = { tractionControl: 0, abs: o.abs, autoGears: true };
  const memory = createAssistState();
  const start = h.car.distance;
  let minSlip = 0;
  let maxBeta = 0;
  while (h.time < 6 && h.car.vx > 100 * KMH) {
    assistRun(h, settings, driver, memory);
    h.step();
    for (let i = 0; i < 4; i++) minSlip = Math.min(minSlip, h.car.slipRatio[i]!);
    maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(h.car.vy, Math.max(Math.abs(h.car.vx), 1))));
  }
  const r: AbsStopResult = {
    abs: o.abs,
    minSlip,
    distance: h.car.distance - start,
    spun: maxBeta > 20 * DEG,
  };
  if (h.trace) r.trace = h.trace;
  return r;
}
