/**
 * The audio engine's input: one car's state as the simulation sees it. Plain data, SI units.
 * The game sends one of these per sim step (60–240 Hz); the audio core interpolates between
 * updates and smooths every value, so a step change in any field never clicks.
 */
export interface AudioCarState {
  /** Engine running. False fades the engine voice out over about 0.3 s; road noise stays. */
  engineOn: boolean;
  /** Crankshaft angular speed, rad/s (12 000 rpm = 1256.6 rad/s). */
  engineSpeed: number;
  /** Throttle pedal, 0–1. */
  throttle: number;
  /**
   * Engine load: delivered torque as a fraction of the full-throttle torque at this speed,
   * 0–1. Low with the throttle closed (overrun), high when pulling. Drives the tone.
   */
  load: number;
  /** Engaged gear: -1 reverse, 0 neutral, 1–8. */
  gear: number;
  /** True for the duration of a gear change (ignition cut or blip window). */
  shifting: boolean;
  /** +1 upshift, -1 downshift, 0 none. Read while `shifting` is true. */
  shiftDirection: number;
  /** Rev limiter cutting ignition. */
  revLimiter: boolean;
  /** Pit-lane speed limiter active. */
  pitLimiter: boolean;
  /** Turbocharger demand, 0–1 (exhaust energy available). The audio turbo spools towards it with lag. */
  boost: number;
  /** MGU-K power, W: positive deploying, negative harvesting (about ±120 kW). */
  ersPower: number;
  /** Road speed, m/s. */
  speed: number;
  /** Combined slip magnitude of the front axle, dimensionless (about 0.1 at peak grip). */
  slipFront: number;
  /** Combined slip magnitude of the rear axle, dimensionless. */
  slipRear: number;
  /** Kerb roughness under the car, 0 (none) to 1 (sausage kerb). */
  kerb: number;
  /** Rate at which kerb ridges pass under the tyres, Hz (speed / ridge spacing). */
  kerbFrequency: number;
  /** Plank or skid-block contact intensity, 0–1. A rising edge also gives a thump. */
  bottoming: number;
}

/**
 * Supported range of each packed field, `[min, max]`. The core clamps to these; a
 * non-finite value keeps the field's last valid value. Engine speed stops at 15 000 rpm,
 * the highest speed the band-limited pulse tables are built for.
 */
export const CAR_STATE_RANGE: Readonly<Record<CarStateField, readonly [number, number]>> = {
  engineOn: [0, 1],
  engineSpeed: [0, (15_000 * 2 * Math.PI) / 60],
  throttle: [0, 1],
  load: [0, 1],
  gear: [-1, 8],
  shifting: [0, 1],
  shiftDirection: [-1, 1],
  revLimiter: [0, 1],
  pitLimiter: [0, 1],
  boost: [0, 1],
  ersPower: [-200_000, 200_000],
  speed: [0, 150],
  slipFront: [0, 2],
  slipRear: [0, 2],
  kerb: [0, 1],
  kerbFrequency: [0, 200],
  bottoming: [0, 1],
};

/** A parked car with the engine off. */
export function defaultCarState(): AudioCarState {
  return {
    engineOn: false,
    engineSpeed: 0,
    throttle: 0,
    load: 0,
    gear: 0,
    shifting: false,
    shiftDirection: 0,
    revLimiter: false,
    pitLimiter: false,
    boost: 0,
    ersPower: 0,
    speed: 0,
    slipFront: 0,
    slipRear: 0,
    kerb: 0,
    kerbFrequency: 0,
    bottoming: 0,
  };
}

/**
 * Field order of the packed form, used to post the state to the audio thread as one
 * Float64Array and to index the per-sample control buffers.
 */
export const CAR_STATE_FIELDS = [
  'engineOn',
  'engineSpeed',
  'throttle',
  'load',
  'gear',
  'shifting',
  'shiftDirection',
  'revLimiter',
  'pitLimiter',
  'boost',
  'ersPower',
  'speed',
  'slipFront',
  'slipRear',
  'kerb',
  'kerbFrequency',
  'bottoming',
] as const satisfies readonly (keyof AudioCarState)[];

export type CarStateField = (typeof CAR_STATE_FIELDS)[number];
export const CAR_STATE_LENGTH = CAR_STATE_FIELDS.length;

/** Index of each field in the packed form (matches CAR_STATE_FIELDS; a test checks). */
export const F = {
  engineOn: 0,
  engineSpeed: 1,
  throttle: 2,
  load: 3,
  gear: 4,
  shifting: 5,
  shiftDirection: 6,
  revLimiter: 7,
  pitLimiter: 8,
  boost: 9,
  ersPower: 10,
  speed: 11,
  slipFront: 12,
  slipRear: 13,
  kerb: 14,
  kerbFrequency: 15,
  bottoming: 16,
} as const satisfies { readonly [K in CarStateField]: number };

/**
 * Pack into `out` (length CAR_STATE_LENGTH). Booleans become 0 or 1; numbers are copied as
 * they are (stored in a Float64Array, anything non-numeric becomes NaN). The audio core
 * validates and clamps every field when it receives a state, in either form.
 * Written field by field: named loads keep this allocation-free on the audio thread.
 */
export function packCarState(state: AudioCarState, out: Float64Array): Float64Array {
  out[F.engineOn] = state.engineOn ? 1 : 0;
  out[F.engineSpeed] = state.engineSpeed;
  out[F.throttle] = state.throttle;
  out[F.load] = state.load;
  out[F.gear] = state.gear;
  out[F.shifting] = state.shifting ? 1 : 0;
  out[F.shiftDirection] = state.shiftDirection;
  out[F.revLimiter] = state.revLimiter ? 1 : 0;
  out[F.pitLimiter] = state.pitLimiter ? 1 : 0;
  out[F.boost] = state.boost;
  out[F.ersPower] = state.ersPower;
  out[F.speed] = state.speed;
  out[F.slipFront] = state.slipFront;
  out[F.slipRear] = state.slipRear;
  out[F.kerb] = state.kerb;
  out[F.kerbFrequency] = state.kerbFrequency;
  out[F.bottoming] = state.bottoming;
  return out;
}

/** Inverse of `packCarState`, writing into an existing object. */
export function unpackCarState(packed: ArrayLike<number>, out: AudioCarState): AudioCarState {
  out.engineOn = (packed[F.engineOn] ?? 0) > 0.5;
  out.engineSpeed = packed[F.engineSpeed] ?? 0;
  out.throttle = packed[F.throttle] ?? 0;
  out.load = packed[F.load] ?? 0;
  out.gear = packed[F.gear] ?? 0;
  out.shifting = (packed[F.shifting] ?? 0) > 0.5;
  out.shiftDirection = packed[F.shiftDirection] ?? 0;
  out.revLimiter = (packed[F.revLimiter] ?? 0) > 0.5;
  out.pitLimiter = (packed[F.pitLimiter] ?? 0) > 0.5;
  out.boost = packed[F.boost] ?? 0;
  out.ersPower = packed[F.ersPower] ?? 0;
  out.speed = packed[F.speed] ?? 0;
  out.slipFront = packed[F.slipFront] ?? 0;
  out.slipRear = packed[F.slipRear] ?? 0;
  out.kerb = packed[F.kerb] ?? 0;
  out.kerbFrequency = packed[F.kerbFrequency] ?? 0;
  out.bottoming = packed[F.bottoming] ?? 0;
  return out;
}

/** rpm to rad/s, for callers that think in rpm (tools, UI). */
export function rpmToRadPerSecond(rpm: number): number {
  return (rpm * 2 * Math.PI) / 60;
}

/** rad/s to rpm. */
export function radPerSecondToRpm(omega: number): number {
  return (omega * 60) / (2 * Math.PI);
}
