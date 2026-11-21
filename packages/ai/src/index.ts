/**
 * AI drivers: the offline racing line and speed profile computed from the same vehicle model
 * the player drives, and the drivers that follow them. Pure: no DOM, no clock, no renderer.
 * A driver produces only a `ControlInput`; the car's physics are exactly the player's.
 */
export type { Driver, DriverSkill } from './driver/driver';
export {
  REFERENCE_GAINS,
  REFERENCE_SKILL,
  ReferenceDriver,
  type ControllerGains,
  type ReferenceDriverOptions,
} from './driver/reference';
export { lockExcess, spinExcess } from './driver/feel';
export {
  EnvelopeModel,
  FULL_ENVELOPE,
  decodeEnvelope,
  type Envelope,
  type EnvelopeArtefact,
  type EnvelopeScale,
} from './envelope/envelope';
export {
  measureEnvelope,
  type MeasureConditions,
  type MeasureOptions,
  type MeasureReport,
} from './envelope/measure';
export { engineRpm, fullLoadTorque, optimalShiftRpm } from './envelope/shift';
export { buildCorridor, type Corridor, type CorridorOptions } from './line/corridor';
export { computeLineGeometry, type LineGeometry } from './line/geometry';
export { curvatureCost, minimumCurvatureLine } from './line/min-curvature';
export { refineLine, type RefineOptions, type RefineResult } from './line/refine';
export { buildRacingLine, type LineBuildResult, type LineConfig } from './line/build';
export { CyclicPentaCholesky, createCyclicPenta, pentaMultiply, solveBoxQp } from './line/qp';
export {
  Phase,
  SpeedProfiler,
  type ProfileOptions,
  type SpeedProfile,
} from './profile/speed-profile';
export { buildPlan, drsZoneFlags, type DrivingPlan, type PlanOptions } from './profile/plan';
export {
  RACING_LINE_FORMAT,
  RACING_LINE_VERSION,
  RacingLineError,
  decodeRacingLine,
  encodeRacingLine,
  inZone,
  racingLineOffsets,
  racingLineSpeeds,
  zonesFromFlags,
  type RacingLineData,
  type Zone,
} from './export/racing-line';
export {
  createReferenceDriver,
  planFromRacingLine,
  referenceLineConfig,
  type ReferenceDriverSetup,
} from './reference-setup';
