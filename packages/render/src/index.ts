/**
 * Rendering of sim state with three.js (WebGL 2): renderer and lighting, the circuit from the
 * track package's meshes, the interim car, the ghost and the cameras. The only package besides
 * apps/web that may import three.js.
 */
export {
  CAMERA_LABELS,
  CAMERA_ORDER,
  CameraRig,
  type CameraFrame,
  type CameraMode,
  type CameraName,
} from './cameras';
export { CarModel, type CarGeometry, type Livery } from './car/car-model';
export { MONZA_AFTERNOON, type LightingPreset } from './environment';
export { QUALITY, defaultQuality, type Quality, type QualityName } from './quality';
export { estimateRacingLine } from './racing-line';
export {
  RaceView,
  createRenderer,
  type RaceViewOptions,
  type ViewFrame,
  type ViewStats,
} from './race-view';

/** Interpolation factor between the previous and current sim state, in [0, 1). */
export type RenderAlpha = number;
