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
 * Where the contact treats a wheel or the floor as striking the ground: a tyre at its bottoming
 * deflection (rim on the ground, margin 0 m), or a floor skid at the depth where its force
 * saturates (the tyre's bottoming load over half the plank stiffness, 24 mm for the reference
 * car). Past that the car is lifted back to it and its velocity into the ground removed, an
 * inelastic rim or floor strike. Resolving it there and not deeper matters: a strike held 50 mm
 * past bottoming left about 2 kJ in each tyre, which came back as a launch when the kerb fell
 * away (review of PR 19). The racing line never gets there (at most 33 mm of tyre compression;
 * the floor never touches). Off it, a raised kerb taken at speed is a real strike; the drive fuzz
 * asserts strikes happen only with a wheel on a kerb (`CarState.contactLifts`).
 */
export const CONTACT_LIFT_MARGIN = 0;

/**
 * The body's footprint for barrier contact, m: nose ahead of the front axle, tail behind the
 * rear axle, half the overall width. Estimate for a 5.6 m car on a 3.6 m wheelbase at the 2 m
 * width limit; the front wing's end plates and the rear wing set the corners.
 */
export const BODY_NOSE = 1.2;
export const BODY_TAIL = 0.8;
export const BODY_HALF_WIDTH = 1.0;
/**
 * Barrier contact: restitution of the normal speed, and friction of the body sliding along the
 * barrier. Estimates: a carbon body against concrete or steel keeps little of its normal speed
 * (crush and tyre barriers keep less), and scrubs at about μ 0.5.
 */
export const WALL_RESTITUTION = 0.1;
export const WALL_FRICTION = 0.5;
/**
 * Moving off a barrier: below WALL_RELEASE_SPEED (m/s), a corner resting on the barrier (not
 * striking it faster than that) does not hold the car by friction while the driver drives with
 * the front wheels pointing along or away from the face: their heading, in the gear's direction,
 * at most WALL_RELEASE_INTO (the sine of the angle) into it. The body's contact then rides along
 * the face, as a wheel or endplate against a wall does, instead of pinning the car on the
 * deflection its tyres stopped with. Impacts and scrapes at speed keep WALL_FRICTION.
 */
export const WALL_RELEASE_SPEED = 2;
export const WALL_RELEASE_INTO = 0.5;

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
