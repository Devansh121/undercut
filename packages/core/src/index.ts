/** Shared foundations: the game name, seeded randomness, small maths and fixed-step timing. */
export { GAME_NAME } from './name';
export { createRng, type Rng, type RngState } from './rng';
export { FixedStepAccumulator, type FixedStepOptions } from './fixed-step';
export { approxEqual, clamp, lerp, wrapAngle } from './math';
