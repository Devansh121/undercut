/**
 * Rendering of sim state with three.js (WebGL 2): the render pipeline and lighting, the circuit
 * with its materials, the car asset and the fleet of other cars, the cameras, and the hooks the
 * trackside dressing uses. The only package besides apps/web that may import three.js.
 * docs/render.md describes the whole.
 */
export { AssetError, AssetLoader, type AssetIndex, type Progress } from './assets/loader';
export {
  CAMERA_LABELS,
  CAMERA_ORDER,
  CameraRig,
  type CameraFrame,
  type CameraMode,
  type CameraName,
} from './cameras';
export { CAR_FILES, type CarLivery } from './car/car-assets';
export { CarModel, type CarGeometry } from './car/car-model';
export { lodBlend } from './car/lod';
export { LightPool, floodlightsAlong, type LocalLight } from './lighting/light-pool';
export {
  MONZA_AFTERNOON,
  NIGHT_FLOODLIT,
  OVERCAST_DAY,
  TIMES_OF_DAY,
  type TimeOfDay,
} from './lighting/time-of-day';
export { DynamicResolution } from './pipeline/dynamic-resolution';
export type { ToneMap } from './pipeline/post';
export {
  PropRegistry,
  boardMaterial,
  type PropKind,
  type PropLod,
  type PropPlacement,
} from './props/registry';
export {
  PLAYER_QUALITIES,
  QUALITY,
  QUALITY_NAMES,
  benchmarkPick,
  defaultQuality,
  isQualityName,
  type CarLod,
  type Quality,
  type QualityName,
} from './quality';
export { estimateRacingLine } from './racing-line';
export {
  RaceView,
  createRenderer,
  type RaceViewOptions,
  type ScreenRect,
  type ViewFrame,
  type ViewStats,
} from './race-view';

/** Interpolation factor between the previous and current sim state, in [0, 1). */
export type RenderAlpha = number;
