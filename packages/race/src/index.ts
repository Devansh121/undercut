/**
 * Race rules: sessions (time trial, practice, qualifying, race), the start procedure, timing,
 * flags, track limits and penalties, DRS and ERS rules, the pit lane and stop sequence, the
 * stuck-car watchdog, results, race weekends and championships. Pure: no DOM, no renderer, no
 * wall clock; seeded randomness only. `RaceControl` is the rules engine over per-tick car
 * facts; `RaceSession` runs it over the sim world with human and AI drivers.
 */
export { CIRCUIT_DATA, circuitInfo, fullRaceLaps, type CircuitInfo } from './circuit';
export {
  RaceControl,
  type EntrantRules,
  type RaceControlOptions,
  type RaceControlSnapshot,
  type StandingRow,
} from './control';
export type { CarStatus, CoreCar, Penalty, RaceCore, RaceSystem } from './core';
export type {
  AnomalyKind,
  FlagKind,
  PenaltyReason,
  Phase,
  PitStage,
  RaceEvent,
  ServiceAction,
} from './events';
export { copyFacts, createFacts, type CarFacts } from './facts';
export {
  PracticeStrategy,
  QualifyingStrategy,
  RaceStrategy,
  TimeTrialStrategy,
  createStrategy,
  type LimitsPolicy,
  type SessionKind,
  type SessionSpec,
  type SessionStrategy,
  type StartKind,
} from './kinds';
export {
  buildResult,
  type EntrantInfo,
  type ResultEntry,
  type ResultStatus,
  type SessionResult,
} from './results';
export {
  COMPOUNDS,
  DEFAULT_RULES,
  POINTS_TABLE,
  SERVICE_TIMES,
  resolveRules,
  type Compound,
  type RaceRules,
} from './rules';
export type { PitPhase } from './systems/pit';
export { createAiField, type AiFieldOptions } from './session/ai-field';
export {
  AiController,
  InputController,
  type AiControllerOptions,
  type CarController,
  type ControlContext,
} from './session/controllers';
export { PIT_MARGIN, pitInPath, pitOutPath } from './session/pit-paths';
export {
  RACE_STEP,
  RaceSession,
  SESSION_FUEL,
  type RaceCar,
  type RaceSessionOptions,
  type RaceSessionSnapshot,
} from './session/session';
export type { Anomaly } from './systems/watchdog';
export {
  LapTimer,
  crossingFraction,
  lapDelta,
  type DeltaClass,
  type LapResult,
  type LapTimerState,
  type TimingBests,
  type TimingEvent,
  type TimingLines,
} from './timing/lap-timer';
export { GapTower } from './timing/tower';
export { TrackLimits, TYRE_HALF_TREAD, type WheelsOffCounter } from './limits-geometry';
export {
  Championship,
  RaceWeekend,
  type ChampionshipState,
  type StandingEntry,
  type WeekendPlan,
  type WeekendState,
} from './weekend';
