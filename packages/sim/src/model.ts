import { brakeCapacity, type CarParams } from './params';
import { createTyreCurve, type TyreCurve } from './tyre';
import { STANDARD_GRAVITY } from './environment';

/** Wheel order in every per-wheel array: front left, front right, rear left, rear right. */
export const FL = 0;
export const FR = 1;
export const RL = 2;
export const RR = 3;

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
  });
}
