import { createRng, type Rng } from '@undercut/core';

export interface WorldOptions {
  /** Fixed simulation step in seconds. */
  step: number;
  /** Seed for every random draw the sim makes. */
  seed: number;
}

/**
 * The simulation state. Placeholder for M0: it only keeps the clock and the RNG.
 * Vehicles, track surface and contacts arrive in M1.
 */
export interface World {
  readonly step: number;
  /** Number of steps taken since the world was created. */
  tick: number;
  /** Sim time in seconds, always `tick * step` so it never drifts. */
  time: number;
  readonly rng: Rng;
}

export function createWorld({ step, seed }: WorldOptions): World {
  if (!(step > 0)) throw new RangeError('step must be > 0');
  return { step, tick: 0, time: 0, rng: createRng(seed) };
}

/** Advance the world by exactly one fixed step. */
export function stepWorld(world: World): void {
  world.tick += 1;
  world.time = world.tick * world.step;
}
