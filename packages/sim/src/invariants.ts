import { tyreBottomDeflection, type CarModel } from './model';
import { CAR_SNAPSHOT_LENGTH, snapshotCar, type CarState } from './state';

/**
 * Physical bounds on a car's pose that hold for any input on any supported surface. A state
 * outside them is a bug in the vehicle model or in the ground it was given, never a driving
 * outcome. Every limit is derived from the car's geometry and the surface's declared
 * discontinuity; docs/physics-validation.md (section "Pose invariants") lists the derivations.
 *
 * Pitch and roll are measured against the plane through the four contact heights the model
 * last sampled (`CarState.groundY`), so a car on a grade or a bank is not penalised for it.
 * Relative pitch is exactly (front ride height − rear ride height) / wheelbase, so the pitch
 * bound follows from the ride-height bounds; roll the same way across the floor's width.
 */
export interface InvariantLimits {
  /** Floor reference height above the ground under each axle, m. */
  readonly rideMin: number;
  readonly rideMax: number;
  /** Body pitch and roll relative to the ground plane under the wheels, rad. */
  readonly pitch: number;
  readonly roll: number;
  /** Wheel centre height above the ground under it, m. */
  readonly wheelMin: number;
  readonly wheelMax: number;
}

export interface InvariantOptions {
  /**
   * Largest height step the surface can present between two points a wheel can be on, m.
   * Zero for a track whose reachable ground is continuous (every shipped circuit, tested in
   * packages/track); the adversarial-surface fuzz declares its own steps.
   */
  surfaceStep?: number;
}

/**
 * How far the body may rise above its static ride height (plus fully unloaded tyres) before it
 * is climbing rather than hopping, m. A car does leave the ground off a kerb; the tallest kerb
 * face on the shipped circuits is 0.13 m, and this allows about four times that. Random driving
 * on Monza, barrier and kerb strikes included, peaks at 0.50 m of floor height over 16.7 h
 * (docs/physics-validation.md, section 7.7), so the limit is reached only by a body being thrown.
 */
export const AIRBORNE_ALLOWANCE = 0.5;
/**
 * How far the floor may sink below the ground, m: twice FLOOR_LIFT_DEPTH, the depth at which the
 * contact lifts the car out. A skid's force saturates at the tyre's bottoming load at 24 mm of
 * plank deflection, well inside it.
 */
export const PLANK_ALLOWANCE = 0.1;

export function invariantLimits(model: CarModel, options: InvariantOptions = {}): InvariantLimits {
  const p = model.params;
  const step = Math.max(0, options.surfaceStep ?? 0);
  const bottom = tyreBottomDeflection(p.tyre);
  const staticRide = Math.max(p.aero.rideHeightFront, p.aero.rideHeightRear);
  // Wheels hanging free add back the tyre's deflection and the spring's static compression.
  const rideMax = staticRide + bottom + AIRBORNE_ALLOWANCE + step;
  const rideMin = -PLANK_ALLOWANCE - step;
  const span = rideMax - rideMin;
  return Object.freeze({
    rideMin,
    rideMax,
    pitch: span / p.geometry.wheelbase,
    roll: span / (2 * p.suspension.floorHalfWidth),
    // A wheel sinks at most to the tyre's bottoming depth plus the plank allowance (the plank
    // takes the load once the floor reaches the ground), plus a step it has not yet climbed.
    wheelMin: p.tyre.freeRadius - bottom - PLANK_ALLOWANCE - step,
    // A wheel hangs from a body that is at most `rideMax` up, through a spring held by its stops.
    wheelMax: p.tyre.freeRadius + rideMax + step,
  });
}

const snap = new Float64Array(CAR_SNAPSHOT_LENGTH);

/**
 * Check one car against `limits`. Returns null when every invariant holds, otherwise a short
 * description of the first one broken. Allocation-free when the car is sane.
 */
export function checkCarInvariants(state: CarState, limits: InvariantLimits): string | null {
  snapshotCar(state, snap);
  for (let k = 0; k < CAR_SNAPSHOT_LENGTH; k++) {
    if (!Number.isFinite(snap[k]!)) return `state value ${k} is not finite`;
  }
  const model = state.model;
  const p = model.params;
  const g = state.groundY;
  const rf = state.rideHeightFront;
  const rr = state.rideHeightRear;
  if (rf > limits.rideMax || rr > limits.rideMax) {
    return `body ${Math.max(rf, rr).toFixed(3)} m above the ground (limit ${limits.rideMax.toFixed(3)})`;
  }
  if (rf < limits.rideMin || rr < limits.rideMin) {
    return `floor ${Math.min(rf, rr).toFixed(3)} m into the ground (limit ${limits.rideMin.toFixed(3)})`;
  }
  const groundPitch = ((g[0]! + g[1]!) / 2 - (g[2]! + g[3]!) / 2) / p.geometry.wheelbase;
  const groundRoll =
    ((g[0]! - g[1]!) / p.geometry.trackFront + (g[2]! - g[3]!) / p.geometry.trackRear) / 2;
  const pitch = state.pitch - groundPitch;
  const roll = state.roll - groundRoll;
  if (Math.abs(pitch) > limits.pitch) {
    return `pitch ${pitch.toFixed(3)} rad off the ground plane (limit ${limits.pitch.toFixed(3)})`;
  }
  if (Math.abs(roll) > limits.roll) {
    return `roll ${roll.toFixed(3)} rad off the ground plane (limit ${limits.roll.toFixed(3)})`;
  }
  for (let i = 0; i < 4; i++) {
    const gap = state.wheelY[i]! - g[i]!;
    if (gap < limits.wheelMin || gap > limits.wheelMax) {
      return `wheel ${i} centre ${gap.toFixed(3)} m above the ground (limits ${limits.wheelMin.toFixed(3)} to ${limits.wheelMax.toFixed(3)})`;
    }
  }
  return null;
}
