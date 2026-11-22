/**
 * AI drivers: the offline racing line and speed profile computed from the same vehicle model
 * the player drives, and the drivers that follow them. Pure: no DOM, no clock, no renderer.
 * A driver produces only a `ControlInput`; the car's physics are exactly the player's.
 */
export type { Driver, DriverMemory, DriverSkill } from './driver/driver';
export {
  REFERENCE_GAINS,
  REFERENCE_SKILL,
  ReferenceDriver,
  type ControllerGains,
  type ReferenceDriverOptions,
} from './driver/reference';
export { lockExcess, spinExcess } from './driver/feel';
export {
  DEFAULT_RACE_SKILL,
  RaceDriver,
  driverSkillFor,
  type RaceDriverOptions,
  type RaceSkill,
} from './driver/race';
export {
  createTrafficCar,
  createTrafficView,
  type TrafficCar,
  type TrafficView,
} from './driver/traffic';
export {
  FOLLOWER_GAINS,
  PathFollower,
  type FollowPoint,
  type FollowerGains,
  type FollowerState,
} from './driver/path-follower';
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
export {
  TYRE_HALF_TREAD,
  buildLegalCorridor,
  legalBound,
  usableBeyondLine,
  wheelOff,
  type LegalCorridorOptions,
} from './line/limits';
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
  createRaceDriver,
  createReferenceDriver,
  planFromRacingLine,
  referenceCorridor,
  referenceLineConfig,
  type RaceDriverSetup,
  type ReferenceDriverSetup,
} from './reference-setup';
export {
  DRIVING_LINE_OPTIONS,
  DRIVING_LINE_SCALE,
  DrivingLine,
  LineCue,
  type DrivingLineOptions,
} from './advice/driving-line';
