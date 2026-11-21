/**
 * Lap and sector timing now lives in the race engine (`@undercut/race`), shared by every
 * session type; these are the names the HUD and results strip use.
 */
export {
  LapTimer,
  crossingFraction,
  type DeltaClass,
  type LapResult,
  type TimingBests,
  type TimingEvent,
  type TimingLines,
} from '@undercut/race';
