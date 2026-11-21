/**
 * A point-mass longitudinal car for scripting audio manoeuvres. Not the vehicle model: just
 * enough physics that rpm, gear, speed and shift timing move the way a real lap moves them.
 * Numbers from docs/physics-validation.md sections 1.1–1.5 (low-drag trim).
 */
import { rpmToRadPerSecond } from '@undercut/audio';

export const CAR = {
  mass: 850, // kg: 800 kg minimum plus fuel
  wheelRadius: 0.355, // m
  /** Overall ratios, engine revs per wheel rev, 1st to 8th. */
  ratios: [16.5, 12.4, 10.1, 8.5, 7.3, 6.3, 5.4, 4.6],
  icePower: 560_000, // W
  mgukPower: 120_000, // W
  drivetrainEfficiency: 0.95,
  rho: 1.17, // kg/m³
  cdA: 1.15, // m²
  clA: 3.6, // m²
  /** Longitudinal grip coefficient for traction and braking. */
  mu: 1.45,
  upshiftRpm: 11_800,
  /** Upshift torque-dip and downshift (with blip) times, s. */
  upshiftTime: 0.03,
  downshiftTime: 0.06,
  idleRpm: 4500,
  limiterRpm: 12_500,
  g: 9.81,
} as const;

/** Engine rpm in a gear (1-based) at a road speed in m/s. */
export function rpmAt(speed: number, gear: number): number {
  const ratio = CAR.ratios[gear - 1] ?? 1;
  return ((speed * ratio) / CAR.wheelRadius) * (60 / (2 * Math.PI));
}

/** Road speed in m/s for an rpm in a gear. */
export function speedAt(rpm: number, gear: number): number {
  const ratio = CAR.ratios[gear - 1] ?? 1;
  return (rpmToRadPerSecond(rpm) * CAR.wheelRadius) / ratio;
}

function downforce(v: number): number {
  return 0.5 * CAR.rho * CAR.clA * v * v;
}

function drag(v: number): number {
  return 0.5 * CAR.rho * CAR.cdA * v * v;
}

/** Longitudinal acceleration at full throttle, m/s², limited by power and by traction. */
export function fullThrottleAccel(v: number, ersOn: boolean): number {
  const power = (CAR.icePower + (ersOn ? CAR.mgukPower : 0)) * CAR.drivetrainEfficiency;
  const tractive = Math.min(
    power / Math.max(v, 1),
    0.55 * CAR.mu * (CAR.mass * CAR.g + downforce(v)),
  );
  return (tractive - drag(v)) / CAR.mass;
}

/** Deceleration on the brakes, m/s² (positive number). */
export function brakingDecel(v: number): number {
  return (CAR.mu * (CAR.mass * CAR.g + downforce(v)) + drag(v)) / CAR.mass;
}

/** Deceleration coasting in gear with the throttle shut: drag plus engine braking. */
export function coastDecel(v: number): number {
  return (drag(v) + 1800) / CAR.mass;
}
