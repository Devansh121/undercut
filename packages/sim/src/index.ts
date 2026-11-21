/** Vehicle and world simulation: fixed timestep, seeded RNG, no DOM, no renderer, no wall clock. */
export { createWorld, stepWorld, type World, type WorldOptions } from './world';
export {
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  SurfaceKind,
  createSurfaceHint,
  createSurfaceSample,
  resetControlInput,
  type ControlInput,
  type SurfaceHint,
  type SurfaceSample,
  type SurfaceSampler,
} from './contracts';
