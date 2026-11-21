import { gearRatio, radToRpm } from '../../src/index';
import type { Harness } from './harness';
import { STEP } from './harness';

/**
 * Scripted drivers for the validation manoeuvres. They play the part of a skilled driver
 * (or the AI's pedal control): they read what a driver feels (speed, wheel slip, yaw rate)
 * and work the pedals and wheel. None of them is an assist; assists are tested separately.
 */

/** Shift point used by the reference lap-time model [44]: 11 800 rpm (doc 1.3). */
export const SHIFT_RPM = 11800;

/** Request an upshift at the shift point and a downshift when the lower gear fits under it. */
export function shiftForSpeed(h: Harness, allowDown = true, downRpm = 11000): void {
  const car = h.car;
  if (car.shiftTimer > 0 || car.gear < 1) return;
  const p = car.model.params;
  const wheel = (car.wheelSpeed[2]! + car.wheelSpeed[3]!) / 2;
  const rpmNow = radToRpm(Math.abs(gearRatio(p, car.gear) * wheel));
  if (car.gear < p.gearbox.ratios.length && rpmNow > SHIFT_RPM) {
    h.input.gearShift = 1;
  } else if (allowDown && car.gear > 1) {
    const lower = radToRpm(Math.abs(gearRatio(p, car.gear - 1) * wheel));
    if (lower < downRpm) h.input.gearShift = -1;
  }
}

/** Mean rear wheel slip speed (wheel surface minus car), m/s. */
function rearSlipSpeed(h: Harness): number {
  const c = h.car;
  const R = c.model.params.tyre.rollingRadius;
  return ((c.wheelSpeed[2]! + c.wheelSpeed[3]!) / 2) * R - c.vx;
}

/**
 * Launch and full-throttle acceleration with the driver holding rear wheelspin near a target
 * slip ratio (no launch control, no traction control). Below a few m/s a slip ratio is
 * meaningless, so the driver holds a minimum slip speed there, as a driver feels wheelspin.
 */
export class LaunchDriver {
  private throttle: number;
  constructor(
    readonly slipTarget: number,
    readonly minSlipSpeed = 1.0,
    initialThrottle = 0.6,
    readonly gain = 8,
  ) {
    this.throttle = initialThrottle;
  }
  tick(h: Harness): void {
    const v = Math.max(h.car.vx, 0);
    const target = Math.max(this.slipTarget * v, this.minSlipSpeed);
    const err = (target - rearSlipSpeed(h)) / (target + 1);
    this.throttle = Math.min(1, Math.max(0.05, this.throttle + this.gain * err * STEP));
    h.input.throttle = this.throttle;
    h.input.brake = 0;
    shiftForSpeed(h, false);
  }
}

/**
 * Threshold braking without ABS: full pedal, eased off whenever the most-locked wheel passes
 * the target slip, as a driver (or the AI pedal control) does to avoid lock-up.
 */
export class ThresholdBrakeDriver {
  private pedal = 1;
  private applied = 0;
  constructor(
    readonly slipTarget = 0.1,
    /** Time to push the pedal from 0 to 1, s. Estimate for a driver's stab at the pedal. */
    readonly applyTime = 0.08,
    /** Pedal released per second per unit of slip beyond the target, and re-applied per s. */
    readonly gain = 400,
    readonly recover = 6,
  ) {}
  tick(h: Harness): void {
    let slip = 0;
    for (let i = 0; i < 4; i++) slip = Math.min(slip, h.car.slipRatio[i]!);
    const excess = -slip - this.slipTarget;
    this.applied = Math.min(1, this.applied + STEP / this.applyTime);
    if (excess > 0) this.pedal -= this.gain * excess * STEP;
    else this.pedal += this.recover * STEP;
    this.pedal = Math.min(1, Math.max(0, this.pedal));
    h.input.brake = Math.min(this.applied, this.pedal);
    h.input.throttle = 0;
    shiftForSpeed(h, true, 11000);
  }
}

/** Throttle (and if needed brake) to hold a forward speed. */
export class SpeedHold {
  constructor(
    public target: number,
    readonly kp = 0.6,
    readonly ki = 0.4,
    /** Starting throttle held by the integrator (a feedforward guess). */
    private integral = 0,
  ) {}
  tick(h: Harness): void {
    const err = this.target - h.car.vx;
    this.integral = Math.min(2, Math.max(-1, this.integral + err * STEP * this.ki));
    const u = this.kp * err + this.integral;
    h.input.throttle = Math.min(1, Math.max(0, u));
    h.input.brake = u < -0.5 ? Math.min(1, -u - 0.5) : 0;
    shiftForSpeed(h, true, 10500);
  }
}

/**
 * Steering to hold a yaw rate (and so a lateral acceleration a = v·r at steady state), as a
 * driver follows a corner of known radius. PI on the yaw-rate error with steer feedforward
 * from the kinematic (Ackermann) angle.
 */
export class YawRateSteer {
  private integral = 0;
  constructor(
    public targetYawRate: number,
    /** Gains in steer demand per (rad/s of error), scaled by 1/speed: yaw gain grows with v. */
    readonly kp = 4,
    readonly ki = 20,
  ) {}
  tick(h: Harness): void {
    const c = h.car;
    const p = c.model.params;
    const v = Math.max(c.vx, 5);
    const ff = (p.geometry.wheelbase * this.targetYawRate) / v / p.geometry.maxSteerAngle;
    const err = this.targetYawRate - c.yawRate;
    this.integral = Math.min(1, Math.max(-1, this.integral + ((this.ki * err) / v) * STEP));
    h.input.steer = Math.min(1, Math.max(-1, ff + (this.kp * err) / v + this.integral));
  }
}
