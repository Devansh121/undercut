import { brakeCapacity, type CarParams, type TyreParams } from './params';
import { createTyreCurve, type TyreCurve } from './tyre';
import { STANDARD_GRAVITY } from './environment';

/** Wheel order in every per-wheel array: front left, front right, rear left, rear right. */
export const FL = 0;
export const FR = 1;
export const RL = 2;
export const RR = 3;

/** Rim radius of the 18-inch wheel, m (457.2 mm bead seat diameter). */
export const RIM_RADIUS = 0.2286;
/**
 * Share of the sidewall height a tyre deflects before the rim flange reaches the ground.
 * Estimate: a low-profile racing tyre bottoms at about 60 % sidewall compression.
 */
export const TYRE_BOTTOM_FRACTION = 0.6;
/**
 * Spring compression at a corner beyond which the bump stop engages, and below which (spring
 * extended past its free length) the droop stop engages, m. The racing line uses at most
 * 16 mm of compression and never extends a spring (docs/physics-validation.md, "Pose
 * invariants"), so neither stop acts in normal driving.
 */
export const BUMP_STOP_GAP = 0.04;
export const DROOP_STOP_GAP = 0.04;
/**
 * Stop rate, N/m, linear past the gap. Stiff enough that a saturated tyre load compresses a
 * stop by under 5 mm, soft enough that the wheel mode stays inside the integrator's stable range
 * (ω·h ≈ 0.55 for a 25 kg corner at the 960 Hz substep).
 */
export const STOP_RATE = 5e6;

/**
 * Rise of the ground under a wheel within one substep beyond which it is a step, not a slope,
 * m. Taller than any kerb on the shipped circuits (0.13 m), so even a kerb face crossed inside
 * one substep is climbed through the tyre. A bigger rise only happens where the ground is
 * discontinuous (bad data, or a surface no car should reach); the contact then lifts the car by
 * the rise at position level, keeping every tyre's compression, so the step adds no energy.
 */
export const GROUND_STEP_RISE = 0.15;
/**
 * Penetration beyond any physical deflection, m: a wheel this far past its bottoming depth, or
 * a floor this far into the ground. The car is lifted out and its velocity into the ground
 * removed (an inelastic rim or floor strike). Normal driving uses at most 33 mm of tyre
 * compression and never puts the floor below the ground, so neither rule acts there; the drive
 * fuzz on the real circuits asserts it (`CarState.contactLifts`).
 */
export const CONTACT_LIFT_MARGIN = 0.05;
export const FLOOR_LIFT_DEPTH = 0.05;

/** Tyre deflection at which the rim reaches the ground, m. */
export function tyreBottomDeflection(tyre: TyreParams): number {
  return TYRE_BOTTOM_FRACTION * (tyre.freeRadius - RIM_RADIUS);
}

/**
 * Values derived once from `CarParams`: the suspension free lengths that put the dry car at its
 * static ride heights, wheel lateral positions, and the tyre curve. Immutable; shared by every
 * state built from the same parameters.
 */
export interface CarModel {
  readonly params: CarParams;
  readonly curve: TyreCurve;
  /** Lateral wheel positions, left positive, m. */
  readonly wheelLeft: Float64Array;
  /** Spring free length per corner (body floor corner height minus wheel-centre height). */
  readonly springFree: Float64Array;
  /** Spring compression of the dry car at rest, for reporting travel relative to static. */
  readonly staticCompression: Float64Array;
  /** Dry-car CoG and fuel-cell positions behind the front axle, m. */
  readonly cgDry: number;
  readonly cgFuel: number;
  /** Shaft efficiency of the ICE, set so full fuel flow gives `engine.peakPower`. */
  readonly iceEfficiency: number;
  /** Total brake torque at full pedal, N·m (`brakeCapacity`). */
  readonly brakeCapacity: number;
  /**
   * Largest vertical force one tyre passes, N: its stiffness times its bottoming deflection.
   * Beyond it the sidewall has collapsed onto the rim and the load is limited by what the rim
   * and upright can take before something gives; the model holds the force there instead of
   * letting a step in the ground produce an unbounded impulse.
   */
  readonly tyreForceMax: number;
}

export function createCarModel(params: CarParams): CarModel {
  const { mass, geometry, tyre, suspension } = params;
  const L = geometry.wheelbase;
  const g = STANDARD_GRAVITY;
  const wheelLeft = new Float64Array([
    geometry.trackFront / 2,
    -geometry.trackFront / 2,
    geometry.trackRear / 2,
    -geometry.trackRear / 2,
  ]);
  const frontAxle = mass.dryMass * mass.frontShareDry * g;
  const rearAxle = mass.dryMass * (1 - mass.frontShareDry) * g;
  const springFree = new Float64Array(4);
  const staticCompression = new Float64Array(4);
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const corner = (front ? frontAxle : rearAxle) / 2;
    const unsprung = (front ? mass.unsprungFront : mass.unsprungRear) * g;
    const sprungLoad = corner - unsprung;
    const k = front ? suspension.springFront : suspension.springRear;
    const wheelY = tyre.freeRadius - corner / tyre.verticalStiffness;
    const ride = front ? params.aero.rideHeightFront : params.aero.rideHeightRear;
    staticCompression[i] = sprungLoad / k;
    springFree[i] = ride - wheelY + sprungLoad / k;
  }
  const fuelEnergyAtFullFlow = params.engine.flowMax * params.engine.fuelEnergy;
  return Object.freeze({
    params,
    curve: createTyreCurve(tyre),
    wheelLeft,
    springFree,
    staticCompression,
    cgDry: L * (1 - mass.frontShareDry),
    cgFuel: L * (1 - mass.fuelFrontShare),
    iceEfficiency: params.engine.peakPower / fuelEnergyAtFullFlow,
    brakeCapacity: brakeCapacity(params.brakes),
    tyreForceMax: tyre.verticalStiffness * tyreBottomDeflection(tyre),
  });
}
