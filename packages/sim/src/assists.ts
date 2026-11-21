import type { ControlInput } from './contracts';
import { gearRatio, type CarState } from './state';
import type { TyreCurve } from './tyre';

/**
 * Driver assists: a pure layer between the driver's `ControlInput` and the input the car
 * receives. They read the car the way an ECU's wheel-speed and yaw sensors would (slip, rpm,
 * speed) and only change pedals and gear requests. They never touch the physics.
 *
 * Each assist has levels; 0 is off. Higher levels intervene earlier.
 */
export interface AssistSettings {
  /** Traction control level 0–3. */
  tractionControl: number;
  /** Anti-lock braking level 0–3. */
  abs: number;
  autoGears: boolean;
}

export const NO_ASSISTS: Readonly<AssistSettings> = Object.freeze({
  tractionControl: 0,
  abs: 0,
  autoGears: false,
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
/** Automatic gearbox: shift up at this rpm; shift down when the lower gear lands below it. */
const UPSHIFT_RPM = 11800;
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
}

export function createAssistState(): AssistState {
  return { tcScale: 1, absScale: 1, shiftHold: 0 };
}

/** Length of an assist snapshot in numbers. */
export const ASSIST_SNAPSHOT_LENGTH = 3;

/** Copy the assist memory into `out` (allocated if absent). */
export function snapshotAssists(memory: AssistState, out?: Float64Array): Float64Array {
  const buf = out ?? new Float64Array(ASSIST_SNAPSHOT_LENGTH);
  if (buf.length < ASSIST_SNAPSHOT_LENGTH) throw new RangeError('snapshot buffer too short');
  buf[0] = memory.tcScale;
  buf[1] = memory.absScale;
  buf[2] = memory.shiftHold;
  return buf;
}

/** Overwrite the assist memory from a snapshot taken by `snapshotAssists`. */
export function restoreAssists(memory: AssistState, snapshot: ArrayLike<number>): void {
  if (snapshot.length < ASSIST_SNAPSHOT_LENGTH) throw new RangeError('snapshot too short');
  memory.tcScale = snapshot[0]!;
  memory.absScale = snapshot[1]!;
  memory.shiftHold = snapshot[2]!;
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

  if (settings.autoGears) out.gearShift = automaticShift(memory, car, driver);
  return out;
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
