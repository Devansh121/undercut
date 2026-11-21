/** Stable error codes in `error` messages. Clients may switch on these; never rename one. */
export const ERROR_CODES = [
  'bad_json',
  'bad_message',
  'too_large',
  'unknown_type',
  'version_mismatch',
  'internal_error',
  'rate_limited',
  'not_joined',
  'already_joined',
  'name_invalid',
  'room_full',
  'room_closed',
  'race_in_progress',
  'resume_invalid',
  'resume_expired',
  'not_host',
  'wrong_phase',
  'bad_settings',
  'no_such_member',
  'not_owner',
  'kicked',
  'too_many_strikes',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * WebSocket close codes the service uses (4000-4999 are for applications). A client
 * must not try to resume after a terminal one.
 */
export const CLOSE = {
  normal: 1000,
  /** The member left on purpose. */
  left: 4000,
  kicked: 4001,
  resumeExpired: 4002,
  roomClosed: 4003,
  tooManyStrikes: 4004,
  roomFull: 4005,
  raceInProgress: 4006,
  versionMismatch: 4007,
  /** No join message within the join timeout. */
  joinTimeout: 4008,
  /** The same member resumed on another socket. */
  replaced: 4009,
  resumeInvalid: 4010,
  nameInvalid: 4011,
} as const;

/** Close codes after which reconnecting cannot succeed. */
export const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  CLOSE.left,
  CLOSE.kicked,
  CLOSE.resumeExpired,
  CLOSE.roomClosed,
  CLOSE.tooManyStrikes,
  CLOSE.roomFull,
  CLOSE.raceInProgress,
  CLOSE.versionMismatch,
  CLOSE.replaced,
  CLOSE.resumeInvalid,
  CLOSE.nameInvalid,
]);

/**
 * Why a timing claim was flagged or rejected. Stable like ERROR_CODES.
 *
 * Rejected (the claim does not count): duplicate, not_racing, not_owner,
 * lap_not_monotonic, lap_too_fast, sector_too_fast, bad_sectors, race_time_mismatch,
 * gap_too_fast, timestamp_implausible, crossed_while_disconnected, s_inconsistent.
 *
 * Flagged (counted, but marked in the results): no_snapshot_evidence, time_mismatch.
 */
export const TIMING_REASONS = [
  'duplicate',
  'not_racing',
  'not_owner',
  'lap_not_monotonic',
  'lap_too_fast',
  'sector_too_fast',
  'bad_sectors',
  'race_time_mismatch',
  'gap_too_fast',
  'timestamp_implausible',
  'crossed_while_disconnected',
  's_inconsistent',
  'no_snapshot_evidence',
  'time_mismatch',
] as const;
export type TimingReason = (typeof TIMING_REASONS)[number];
