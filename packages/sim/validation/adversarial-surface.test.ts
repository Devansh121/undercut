import { createRng, type Rng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_INPUT,
  SurfaceKind,
  checkCarInvariants,
  createCarParams,
  createCarState,
  createEnvironment,
  invariantLimits,
  snapshotCar,
  stepCar,
  type CarState,
  type ControlInput,
  type SurfaceSampler,
} from '../src/index';
import { STEP } from './lib/index';

/**
 * The vehicle model must survive ground that no real track has: a patchwork of cells, each
 * with its own height (steps of up to ±2 m between neighbours), a random normal unrelated to
 * the heights, and random grip and drag. Nothing here is realistic; the point is that the pose
 * stays inside its physical bounds because the forces say so.
 */
const MAX_STEP = 2;

function hash(a: number, b: number, seed: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function patchwork(seed: number, cell: number): SurfaceSampler {
  return {
    sample(x, z, _hint, out) {
      const i = Math.floor(x / cell);
      const j = Math.floor(z / cell);
      // A third of the cells are level with the datum, so the car also meets single steps, and
      // the car starts on a level pad (a car cannot be placed across a step).
      const r = x * x + z * z < 400 ? 0 : hash(i, j, seed);
      out.height = r < 0.33 ? 0 : (hash(i, j, seed + 1) - 0.5) * MAX_STEP;
      const tilt = hash(i, j, seed + 2) * 0.35;
      const dir = hash(i, j, seed + 3) * 2 * Math.PI;
      out.normalX = Math.sin(tilt) * Math.cos(dir);
      out.normalY = Math.cos(tilt);
      out.normalZ = Math.sin(tilt) * Math.sin(dir);
      out.grip = 0.2 + hash(i, j, seed + 4);
      out.drag = 1 + 9 * hash(i, j, seed + 5) ** 3;
      out.roughness = 0.05 * hash(i, j, seed + 6);
      out.kind = SurfaceKind.Grass;
      out.s = Number.NaN;
      out.d = Number.NaN;
    },
  };
}

function randomInput(rng: Rng, inp: ControlInput, tick: number, hold: { left: number }): void {
  if (--hold.left <= 0) {
    hold.left = 1 + Math.floor(rng.next() * 240);
    inp.steer = rng.next() < 0.3 ? (rng.next() < 0.5 ? -1 : 1) : rng.range(-1, 1);
    inp.throttle = rng.next() < 0.5 ? 1 : rng.next();
    inp.brake = rng.next() < 0.25 ? rng.next() : 0;
    inp.drs = rng.next() < 0.3;
  }
  inp.gearShift = tick % 7 === 0 && rng.next() < 0.1 ? (rng.next() < 0.6 ? 1 : -1) : 0;
}

interface Run {
  failure: string | null;
  snapshot: number[];
  airborneTicks: number;
  maxRide: number;
}

function run(seed: number, seconds: number): Run {
  const rng = createRng(seed);
  const params = createCarParams((['low', 'medium', 'high'] as const)[seed % 3]!);
  const surface = patchwork(seed * 7919, 4 + 12 * rng.next());
  const env = createEnvironment();
  const car: CarState = createCarState(params, {
    speed: 20 + 60 * rng.next(),
    yaw: rng.range(-Math.PI, Math.PI),
    surface,
  });
  const limits = invariantLimits(car.model, { surfaceStep: MAX_STEP });
  const inp: ControlInput = { ...NEUTRAL_INPUT };
  const hold = { left: 0 };
  let failure: string | null = null;
  let airborneTicks = 0;
  let maxRide = 0;
  const n = Math.round(seconds / STEP);
  for (let t = 0; t < n && failure === null; t++) {
    randomInput(rng, inp, t, hold);
    stepCar(car, inp, surface, STEP, env);
    const why = checkCarInvariants(car, limits);
    if (why !== null) failure = `t=${(t * STEP).toFixed(3)} s: ${why}`;
    if (car.load[0]! + car.load[1]! + car.load[2]! + car.load[3]! === 0) airborneTicks++;
    maxRide = Math.max(maxRide, car.rideHeightFront, car.rideHeightRear);
  }
  return { failure, snapshot: Array.from(snapshotCar(car)), airborneTicks, maxRide };
}

describe('vehicle model on adversarial ground (steps to ±2 m, random normals and grip)', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6];
  for (const seed of SEEDS) {
    it(`seed ${seed}: the pose stays inside its bounds for 30 s`, () => {
      const r = run(seed, 30);
      expect(r.failure).toBeNull();
      // The ground did throw the car about: it left the ground at some point.
      expect(r.airborneTicks).toBeGreaterThan(0);
    });
  }

  it('is deterministic: the same seed gives the same state, bit for bit', () => {
    expect(run(3, 8).snapshot).toEqual(run(3, 8).snapshot);
  });
});
