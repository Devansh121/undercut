export { AudioCore, MAX_SAMPLE_RATE, MIN_SAMPLE_RATE, type AudioCoreOptions } from './core';
export { CHUNK } from './controls';
export { DEFAULT_LIMITER, softClip, type LimiterOptions } from './limiter';
export { LAYERS, LayerMeters, type LayerName } from './meters';
export { DUCKING, Ducker } from './ducking';
export { IMPACT_FULL_SPEED, IMPACT_MIN_SPEED } from './impact';
export { DRS_WIND, SLIP_VOICES } from './road-voice';
export {
  DEFAULT_POWER_UNIT,
  type Formant,
  type GearboxSoundSpec,
  type PowerUnitSoundSpec,
} from './spec';
export { AUDIO_VIEWS, VIEW_BALANCE, type AudioView, type ViewBalance } from './view';
export {
  CAR_STATE_FIELDS,
  CAR_STATE_RANGE,
  CAR_STATE_LENGTH,
  defaultCarState,
  packCarState,
  radPerSecondToRpm,
  rpmToRadPerSecond,
  SLIP_LIMIT,
  unpackCarState,
  type AudioCarState,
} from './state';
export type { BusId, GainId, Voice } from './voice';

export {
  SceneSound,
  AUDIBLE_CARS,
  OTHER_CAR_CAPACITY,
  type AudioScene,
  type AudioCue,
  type OtherCarSound,
} from './scene';
