import type { ControlInput } from './contracts';
import { computeMass, gearRatio, type CarState, type MassState } from './state';
import { engineFullLoadTorque } from './step';
import type { TyreCurve } from './tyre';

/**
 * Driver assists: a pure layer between the driver's `ControlInput` and the input the car
 * receives. They read the car the way an ECU's wheel-speed and yaw sensors would (slip, rpm,
 * speed, yaw rate) and change only pedal, per-wheel brake and gear demands. They never touch the
 * steering or the physics.
 *
 * Each assist has levels; 0 is off. Higher levels intervene earlier.
 *
 * Traction control and the stability assist take engine torque away only down to the point
 * where the engine neither drives nor brakes (they never leave engine braking on a wheel they
 * are trying to save). The stability assist works like road-car stability control: it compares
 * the car's yaw rate with the one the driver's steering asks for and brakes a single wheel to
 * correct it. It never eases the driver's brake.
 */
export interface AssistSettings {
  /** Traction control level 0–3. */
  tractionControl: number;
  /** Anti-lock braking level 0–3. */
  abs: number;
  autoGears: boolean;
  /**
   * Stability assist, 0 (off) or 1 (on). Yaw-rate control against a reference from the
   * driver's steer and speed (capped by the grip the car has): oversteer brakes the outer front
   * wheel, takes drive away down to neutral and cancels engine braking on the rear; understeer
   * brakes the inner rear and eases the throttle. Automatic down-shifts wait while it corrects.
   */
  stability?: number;
}

export const NO_ASSISTS: Readonly<AssistSettings> = Object.freeze({
  tractionControl: 0,
  abs: 0,
  autoGears: false,
  stability: 0,
});

/**
 * Combined slip each level holds the tyres under, as a multiple of the slip at peak force
 * (1.0 = the top of the friction curve; see `tyre.ts`). Level 0 = off. The rear limit for ABS
 * is lower so that braking in a turn keeps lateral grip at the rear and the car stays stable.
 */
const TC_LIMIT = [Infinity, 1.25, 1.1, 0.95] as const;
const ABS_LIMIT = [Infinity, 1.25, 1.1, 0.95] as const;
const ABS_REAR_FACTOR = 0.65;
/** Integrator rates: pedal scale lost per second per unit of excess slip, and regained per s. */
const TC_GAIN = 150;
const TC_RECOVER = 3;
const ABS_GAIN = 150;
const ABS_RECOVER = 5;
/** Immediate cut per unit of excess slip, on top of the integrator. */
const DIRECT_CUT = 3;
/**
 * Below this forward speed, m/s, slip is no measure of wheelspin: a stopped tyre keeps the
 * deflection it stopped with, which reads as a large slip angle. Unless a driven wheel's tread
 * really runs faster than the car (by TC_SPIN_SPEED, m/s), traction control there leaves at
 * least the launch throttle, so a car stopped against a barrier or in the run-off can move off.
 * A launch with real wheelspin is cut as before.
 */
const TC_LAUNCH_SPEED = 2;
const TC_LAUNCH_THROTTLE = 0.3;
const TC_SPIN_SPEED = 1;
/** Automatic gearbox: shift up at this rpm; shift down when the lower gear lands below it. */
const UPSHIFT_RPM = 11800;
/**
 * Stability assist (`ESC.*`). Speeds in m/s, yaw rates in rad/s, angles in rad, wheel brake as a
 * share of that wheel's full braking torque.
 */
const ESC = Object.freeze({
  /** Below this speed yaw control means nothing. */
  minSpeed: 8,
  /** Time constant of the reference yaw rate: how fast the car's yaw can follow the wheel, s. */
  referenceLag: 0.12,
  /** Share of the tyres' peak lateral grip the reference may ask for. */
  grip: 1,
  /** Yaw-rate error tolerated before a wheel is braked: fixed plus a share of the reference. */
  overDeadband: 0.04,
  overDeadbandShare: 0.08,
  underDeadband: 0.08,
  underDeadbandShare: 0.25,
  /** Wheel brake per rad/s of error past the deadband, and the most one wheel gets. */
  overGain: 2.5,
  underGain: 1.2,
  maxOver: 0.6,
  maxUnder: 0.3,
  /** Drive taken away: all of it (down to neutral) by this much error past the deadband. */
  driveSpan: 0.25,
  /** How fast a wheel brake builds and releases, share per second. */
  rise: 10,
  fall: 20,
  /** A braked wheel past this multiple of the peak slip ratio has its stability brake cut. */
  lock: 1.2,
  /**
   * An axle counts as at its grip: rear slip angle at this share of the peak (or body sideslip
   * past `betaGate`) for oversteer, front slip angle at this share for understeer.
   */
  rearGate: 0.85,
  betaGate: 0.07,
  frontGate: 1,
  /** Sideslip past this and growing is oversteer whatever the steering asks; per rad past it. */
  betaLimit: 0.1,
  betaGain: 3,
});

/**
 * Below this road speed a driver's downshift request in first passes through, so a stopped car
 * can go 1 → N → R with automatic gears on. The gearbox itself refuses reverse above 1 m/s.
 */
const REVERSE_SELECT_SPEED = 1;
const DOWNSHIFT_TARGET_RPM = 10800;

/**
 * Memory the assists carry between ticks. Kept apart from the physics state: snapshot it with
 * `snapshotAssists` next to `snapshotCar` so a restored car continues with the same interventions.
 */
export interface AssistState {
  /** Throttle and brake multipliers in [0, 1]. */
  tcScale: number;
  absScale: number;
  /** Ticks to wait before the next automatic shift request. */
  shiftHold: number;
  /** Stability assist: the reference yaw rate (rad/s) and each wheel's brake demand. */
  refYaw: number;
  readonly wheelBrake: Float64Array;
}

export function createAssistState(): AssistState {
  return { tcScale: 1, absScale: 1, shiftHold: 0, refYaw: 0, wheelBrake: new Float64Array(4) };
}

/** Length of an assist snapshot in numbers. */
export const ASSIST_SNAPSHOT_LENGTH = 8;

/** Copy the assist memory into `out` (allocated if absent). */
export function snapshotAssists(memory: AssistState, out?: Float64Array): Float64Array {
  const buf = out ?? new Float64Array(ASSIST_SNAPSHOT_LENGTH);
  if (buf.length < ASSIST_SNAPSHOT_LENGTH) throw new RangeError('snapshot buffer too short');
  buf[0] = memory.tcScale;
  buf[1] = memory.absScale;
  buf[2] = memory.shiftHold;
  buf[3] = memory.refYaw;
  for (let i = 0; i < 4; i++) buf[4 + i] = memory.wheelBrake[i]!;
  return buf;
}

/** Overwrite the assist memory from a snapshot taken by `snapshotAssists`. */
export function restoreAssists(memory: AssistState, snapshot: ArrayLike<number>): void {
  if (snapshot.length < ASSIST_SNAPSHOT_LENGTH) throw new RangeError('snapshot too short');
  memory.tcScale = snapshot[0]!;
  memory.absScale = snapshot[1]!;
  memory.shiftHold = snapshot[2]!;
  memory.refYaw = snapshot[3]!;
  for (let i = 0; i < 4; i++) memory.wheelBrake[i] = snapshot[4 + i]!;
}

/**
 * Map `driver` to `out` for one tick of length `dt`. `out` may be `driver` itself.
 */
export function applyAssists(
  settings: AssistSettings,
  memory: AssistState,
  car: CarState,
  driver: ControlInput,
  dt: number,
  out: ControlInput,
): ControlInput {
  const throttle = driver.throttle;
  const brake = driver.brake;
  out.steer = driver.steer;
  out.drs = driver.drs;
  out.overtake = driver.overtake;
  out.pitLimiter = driver.pitLimiter;
  out.gearShift = driver.gearShift;

  // Traction control: hold the driven wheels' combined slip under the level's limit.
  const curve = car.model.curve;
  const tcLimit = TC_LIMIT[clampLevel(settings.tractionControl)];
  let tcCut = 1;
  if (tcLimit !== Infinity && throttle > 0) {
    let excess = -Infinity;
    // Driving slip is in the direction the gearbox drives: negative in reverse. Slip the other
    // way is braking or deflection left in a stopped tyre, never wheelspin.
    const drive = car.gear < 0 ? -1 : 1;
    for (let i = 2; i < 4; i++) {
      if (car.slipRatio[i]! * drive <= 0) continue;
      excess = Math.max(excess, combinedSlip(car, curve, i) - tcLimit);
    }
    if (excess > 0) memory.tcScale -= TC_GAIN * excess * dt;
    else memory.tcScale += TC_RECOVER * dt;
    memory.tcScale = clamp01(memory.tcScale);
    tcCut = excess > 0 ? clamp01(1 - DIRECT_CUT * excess) : 1;
  } else {
    memory.tcScale = 1;
  }
  out.throttle = throttle * memory.tcScale * tcCut;
  // Traction control only removes drive: never below the throttle that cancels engine drag
  // (unless the driver asked for less), or it would brake the wheels it is saving.
  if (out.throttle < throttle)
    out.throttle = Math.max(out.throttle, Math.min(throttle, neutralThrottle(car)));
  if (out.throttle < throttle && Math.abs(car.vx) < TC_LAUNCH_SPEED && !driveWheelsSpin(car))
    out.throttle = Math.max(out.throttle, Math.min(throttle, TC_LAUNCH_THROTTLE));

  // ABS: hold every braked wheel's combined slip under the level's limit (lower at the rear).
  const absLimit = ABS_LIMIT[clampLevel(settings.abs)];
  let absCut = 1;
  if (absLimit !== Infinity && brake > 0 && Math.abs(car.vx) > 3) {
    let excess = -Infinity;
    for (let i = 0; i < 4; i++) {
      if (car.slipRatio[i]! >= 0) continue;
      const limit = i < 2 ? absLimit : absLimit * ABS_REAR_FACTOR;
      excess = Math.max(excess, combinedSlip(car, curve, i) - limit);
    }
    if (excess > 0) memory.absScale -= ABS_GAIN * excess * dt;
    else memory.absScale += ABS_RECOVER * dt;
    memory.absScale = clamp01(memory.absScale);
    absCut = excess > 0 ? clamp01(1 - DIRECT_CUT * excess) : 1;
  } else {
    memory.absScale = 1;
  }
  out.brake = brake * memory.absScale * absCut;

  // Stability: yaw-rate control with one braked wheel and engine torque.
  const correcting = (settings.stability ?? 0) > 0 ? stabilityControl(memory, car, dt, out) : 0;
  if ((settings.stability ?? 0) <= 0) {
    memory.refYaw = car.yawRate;
    memory.wheelBrake.fill(0);
    out.wheelBrake = undefined;
  }

  if (settings.autoGears) {
    out.gearShift = automaticShift(memory, car, driver);
    if (correcting > 0 && out.gearShift < 0) out.gearShift = 0;
  }
  return out;
}

const escMass: MassState = {
  total: 0,
  sprung: 0,
  a: 0,
  b: 0,
  sprungA: 0,
  sprungB: 0,
  yawInertia: 0,
};

/**
 * The stability assist for one tick. The reference yaw rate is what the steering asks for at
 * this speed on a neutral car (v·δ / L), held within the grip the tyres have (μ · total load /
 * mass, over v) and lagged by the car's yaw response. Turning faster than that in the direction
 * of rotation is oversteer: the outer front wheel is braked (its drag turns the car back) and
 * drive comes off the rear down to neutral, with engine braking cancelled if the driver has
 * lifted. Turning slower than asked is understeer: the inner rear is braked and the throttle
 * eased. Writes `out.throttle` and `out.wheelBrake`; returns the oversteer being corrected,
 * rad/s past the deadband (0 if none).
 */
function stabilityControl(
  memory: AssistState,
  car: CarState,
  dt: number,
  out: ControlInput,
): number {
  const wb = memory.wheelBrake;
  const v = car.vx;
  let over = 0;
  let under = 0;
  let target = -1;
  let amount = 0;
  if (v >= ESC.minSpeed) {
    const p = car.model.params;
    const m = computeMass(car.model, car.fuelMass, escMass).total;
    const curve = car.model.curve;
    const grip =
      (ESC.grip * curve.muY * (m * 9.80665 + car.downforceFront + car.downforceRear)) / m;
    const rMax = grip / v;
    const asked = (v * out.steer * p.geometry.maxSteerAngle) / p.geometry.wheelbase;
    const ref = asked > rMax ? rMax : asked < -rMax ? -rMax : asked;
    memory.refYaw += (ref - memory.refYaw) * Math.min(1, dt / ESC.referenceLag);
    const r = car.yawRate;
    const e = r - memory.refYaw;
    const refMag = Math.abs(memory.refYaw);
    // Only an axle that is at its grip counts: a car merely turning faster than a released key
    // asks is not sliding. Rear at or near peak slip angle (or the body sliding) for oversteer,
    // front past peak for understeer.
    const peakTan = curve.peakSlipTan;
    const rearTan = Math.max(Math.abs(car.slipTan[2]!), Math.abs(car.slipTan[3]!));
    const frontTan = Math.max(Math.abs(car.slipTan[0]!), Math.abs(car.slipTan[1]!));
    const beta = Math.abs(Math.atan2(car.vy, v));
    const rearGone = rearTan >= ESC.rearGate * peakTan || beta > ESC.betaGate;
    const frontGone = frontTan >= ESC.frontGate * peakTan;
    // Sideslip past the limit and still growing counts as oversteer whatever the steering asks
    // (a driver holding lock while the car swaps ends).
    const betaSigned = Math.atan2(car.vy, v);
    const betaOver = betaSigned * r < 0 ? ESC.betaGain * (beta - ESC.betaLimit) : 0;
    const yawOver =
      e * r > 0 && rearGone ? Math.abs(e) - (ESC.overDeadband + ESC.overDeadbandShare * refMag) : 0;
    if (yawOver > 0 || betaOver > 0) {
      over = Math.max(yawOver, betaOver);
      // Too much rotation to the left: brake the front right, and the reverse.
      target = r > 0 ? 1 : 0;
      amount = Math.min(ESC.maxOver, ESC.overGain * over);
    } else if (e * memory.refYaw < 0 && frontGone) {
      under = Math.abs(e) - (ESC.underDeadband + ESC.underDeadbandShare * refMag);
      if (under > 0) {
        // Not turning left enough: brake the rear left, and the reverse.
        target = memory.refYaw > 0 ? 2 : 3;
        amount = Math.min(ESC.maxUnder, ESC.underGain * under);
      }
    }
    // A rear wheel the extra brake would lock gets none: a locked rear swings the car round.
    // The outer front in oversteer keeps its brake even locked (on grass or gravel the least
    // brake locks it): a sliding front still drags the nose back and turns the car less.
    if (target >= 2 && -car.slipRatio[target]! > ESC.lock * curve.peakSlipRatio) amount = 0;
  } else {
    memory.refYaw = car.yawRate;
  }
  let any = false;
  for (let i = 0; i < 4; i++) {
    const want = i === target ? amount : 0;
    const now = wb[i]!;
    wb[i] = want > now ? Math.min(want, now + ESC.rise * dt) : Math.max(want, now - ESC.fall * dt);
    if (wb[i]! > 0) any = true;
  }
  out.wheelBrake = any ? wb : undefined;

  if (over > 0 || under > 0) {
    const neutral = neutralThrottle(car);
    const keep = clamp01(1 - Math.max(over, under) / ESC.driveSpan);
    if (out.throttle > neutral) out.throttle = neutral + (out.throttle - neutral) * keep;
    else if (over > 0 && out.brake < 0.02) out.throttle = neutral;
  }
  return over > 0 ? over : 0;
}

/**
 * The throttle at which the engine neither drives nor brakes at its present speed: full-load
 * torque and drag torque cancel. Below it the driven wheels are engine-braked.
 */
export function neutralThrottle(car: CarState): number {
  const eng = car.model.params.engine;
  const rpm = (car.engineSpeed * 60) / (2 * Math.PI);
  const drag = eng.dragTorqueBase + eng.dragTorquePerRpm * rpm;
  const wot = engineFullLoadTorque(eng, car.model.iceEfficiency, rpm);
  return wot + drag > 0 ? drag / (wot + drag) : 0;
}

function automaticShift(memory: AssistState, car: CarState, driver: ControlInput): -1 | 0 | 1 {
  if (memory.shiftHold > 0) {
    memory.shiftHold -= 1;
    return 0;
  }
  if (car.shiftTimer > 0) return 0;
  const p = car.model.params;
  const top = p.gearbox.ratios.length;
  const gear = car.gear;
  // Reverse and neutral stay manual; a driver request out of neutral is passed through.
  if (gear <= 0) return driver.gearShift;
  // Nearly stopped in first, the driver may step down to neutral (and on to reverse).
  if (gear === 1 && driver.gearShift < 0 && Math.abs(car.vx) < REVERSE_SELECT_SPEED) return -1;
  const wheel = (car.wheelSpeed[2]! + car.wheelSpeed[3]!) / 2;
  const rpmNow = (Math.abs(gearRatio(p, gear) * wheel) * 60) / (2 * Math.PI);
  let request: -1 | 0 | 1 = 0;
  if (gear < top && rpmNow > UPSHIFT_RPM && driver.throttle > 0.05) request = 1;
  else if (gear > 1) {
    const lower = (Math.abs(gearRatio(p, gear - 1) * wheel) * 60) / (2 * Math.PI);
    if (lower < DOWNSHIFT_TARGET_RPM) request = -1;
  }
  if (request !== 0) memory.shiftHold = 3;
  return request;
}

/**
 * Speed-sensitive steering for keyboards and touch: full lock at parking speeds, falling with
 * speed so a digital press asks for a sensible angle. Returns the scaled steer demand.
 * `fullLockSpeed` and `highSpeedScale` describe the curve: the scale is 1 up to the first,
 * then falls as 1 / (1 + ((v − v0) / v0)²) toward `highSpeedScale`.
 */
export function speedSensitiveSteer(
  steer: number,
  speed: number,
  fullLockSpeed = 15,
  highSpeedScale = 0.12,
): number {
  const v = Math.abs(speed);
  if (v <= fullLockSpeed) return steer;
  const x = (v - fullLockSpeed) / fullLockSpeed;
  const scale = highSpeedScale + (1 - highSpeedScale) / (1 + x * x);
  return steer * scale;
}

/** Slip of wheel `i` relative to the slip at peak force, both directions combined. */
/** Whether a driven wheel's tread runs faster than the car over the ground, in its gear's sense. */
function driveWheelsSpin(car: CarState): boolean {
  const r = car.model.params.tyre.rollingRadius;
  const drive = car.gear < 0 ? -1 : 1;
  for (let i = 2; i < 4; i++)
    if ((car.wheelSpeed[i]! * r - car.vx) * drive > TC_SPIN_SPEED) return true;
  return false;
}

function combinedSlip(car: CarState, curve: TyreCurve, i: number): number {
  const sx = car.slipRatio[i]! / curve.peakSlipRatio;
  const sy = car.slipTan[i]! / curve.peakSlipTan;
  return Math.sqrt(sx * sx + sy * sy);
}

function clampLevel(level: number): 0 | 1 | 2 | 3 {
  const l = Math.round(level);
  return (l <= 0 ? 0 : l >= 3 ? 3 : l) as 0 | 1 | 2 | 3;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
