/**
 * Contracts between the simulation and its neighbours. Types and constants only.
 *
 * - `ControlInput` is what a driver asks of the car on one sim tick. The input layer (human
 *   devices plus assists) and the AI drivers both produce it; the vehicle model consumes it.
 * - `SurfaceSampler` is how the vehicle model reads the ground. The track package implements it;
 *   the sim ships a flat implementation for tests and validation manoeuvres.
 */

/** One tick of driver demand. All fields are already filtered, assisted and clamped. */
export interface ControlInput {
  /** Steering demand in [-1, 1]. Positive steers left (positive yaw), matching the body frame. */
  steer: number;
  /** Throttle pedal in [0, 1]. */
  throttle: number;
  /** Brake pedal in [0, 1]. */
  brake: number;
  /**
   * Gear change request for this tick: +1 up, -1 down, 0 none. Producers raise it for exactly
   * one tick per shift; the gearbox ignores requests while a shift is in progress.
   */
  gearShift: -1 | 0 | 1;
  /** Driver asks for the DRS flap to be open. The rules decide whether it may open. */
  drs: boolean;
  /** Driver holds the overtake button: maximum ERS deployment while allowed. */
  overtake: boolean;
  /** Pit-lane speed limiter engaged. */
  pitLimiter: boolean;
}

/** A car with no driver demand: wheel straight, pedals released, nothing pressed. */
export const NEUTRAL_INPUT: Readonly<ControlInput> = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  gearShift: 0,
  drs: false,
  overtake: false,
  pitLimiter: false,
});

/** Writes neutral demand into `out` and returns it. Lets hot loops reuse one object. */
export function resetControlInput(out: ControlInput): ControlInput {
  out.steer = 0;
  out.throttle = 0;
  out.brake = 0;
  out.gearShift = 0;
  out.drs = false;
  out.overtake = false;
  out.pitLimiter = false;
  return out;
}

/** What a tyre can be standing on. Numeric so it packs into typed arrays and snapshots. */
export const SurfaceKind = {
  Asphalt: 0,
  /** Painted lines and painted run-off: asphalt underneath, lower grip. */
  Paint: 1,
  Kerb: 2,
  /** Asphalt run-off outside the track limits. */
  RunoffAsphalt: 3,
  Grass: 4,
  Gravel: 5,
  PitLane: 6,
  /** Beyond the drivable world (behind barriers). Contact code keeps cars out of it. */
  OutOfBounds: 7,
} as const;
export type SurfaceKind = (typeof SurfaceKind)[keyof typeof SurfaceKind];

/** The ground under one point, in the world frame (+Y up). Filled in place by a sampler. */
export interface SurfaceSample {
  /** Surface height (world Y) at the queried (x, z), in metres. */
  height: number;
  /** Unit surface normal, world frame. Flat ground is (0, 1, 0). */
  normalX: number;
  normalY: number;
  normalZ: number;
  /** Friction multiplier relative to clean dry racing asphalt (1.0). */
  grip: number;
  /** Rolling-resistance multiplier relative to asphalt (1.0); gravel is much higher. */
  drag: number;
  /** Peak-to-peak height of surface texture the tyre feels, in metres (0 on smooth asphalt). */
  roughness: number;
  kind: SurfaceKind;
  /** Track coordinates of the point when the sampler knows them, else NaN. */
  s: number;
  d: number;
}

/**
 * Caller-owned search state for one moving query point (one per wheel, one per car centre).
 * Samplers store whatever makes the next nearby lookup cheap (for a track: the last segment).
 * Start from `createSurfaceHint()`; never share one hint between two points.
 */
export interface SurfaceHint {
  index: number;
}

export function createSurfaceHint(): SurfaceHint {
  return { index: -1 };
}

export function createSurfaceSample(): SurfaceSample {
  return {
    height: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    grip: 1,
    drag: 1,
    roughness: 0,
    kind: SurfaceKind.Asphalt,
    s: Number.NaN,
    d: Number.NaN,
  };
}

/** Ground query used by the vehicle model: called per wheel per tick, so it must not allocate. */
export interface SurfaceSampler {
  /** Fills `out` for the world point (x, z). `hint` belongs to this query point. */
  sample(x: number, z: number, hint: SurfaceHint, out: SurfaceSample): void;
}

/** Infinite flat asphalt at y = 0. For unit tests and straight-line validation manoeuvres. */
export const FLAT_SURFACE: SurfaceSampler = Object.freeze({
  sample(_x: number, _z: number, _hint: SurfaceHint, out: SurfaceSample): void {
    out.height = 0;
    out.normalX = 0;
    out.normalY = 1;
    out.normalZ = 0;
    out.grip = 1;
    out.drag = 1;
    out.roughness = 0;
    out.kind = SurfaceKind.Asphalt;
    out.s = Number.NaN;
    out.d = Number.NaN;
  },
});
