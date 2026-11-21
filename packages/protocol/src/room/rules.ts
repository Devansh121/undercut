/**
 * Clock and abuse rules of a room. Timings are server-owned; the service may override
 * them from its configuration (tests shorten them), never a client.
 */
import { int, object, type Check, type Checked } from '../validate';

export interface RoomTimings {
  /** All members ready: countdown before the grid forms. */
  readyCountdownMs: number;
  /** Longest wait for every client to load the circuit. */
  gridTimeoutMs: number;
  /** Cars hold on the grid this long before the first light. */
  formationMs: number;
  lightIntervalMs: number;
  lightCount: number;
  /** Random hold after the last light, chosen by the server: [holdMinMs, holdMaxMs]. */
  holdMinMs: number;
  holdMaxMs: number;
  /** After the chequered flag, at least this long for the others to finish. */
  finishWindowMinMs: number;
  /** The race ends at laps x circuit.maxLapMs, never later than this. */
  raceCapMaxMs: number;
  resultsLingerMs: number;
  /** Racing with no snapshots for this long: stale. */
  staleMs: number;
  /** Racing with no snapshots for this long: away, as if disconnected (grace starts). */
  awayMs: number;
  /** Time to come back to the same seat after a disconnect. */
  graceMs: number;
  /** A socket must join within this long of opening. */
  joinTimeoutMs: number;
  /** A room with no members closes after this long. */
  roomLingerMs: number;
  /** A created room nobody joins closes after this long. */
  emptyRoomTtlMs: number;
  /**
   * A room closes once it is this old, at the first moment it is in the lobby: a race
   * running at the cap finishes and shows its results first. Infinite by default; the
   * public deployment sets it so a forgotten tab cannot keep a room alive for days.
   */
  maxRoomAgeMs: number;
}

export const DEFAULT_TIMINGS: RoomTimings = {
  readyCountdownMs: 3000,
  gridTimeoutMs: 20_000,
  formationMs: 3000,
  lightIntervalMs: 1000,
  lightCount: 5,
  holdMinMs: 200,
  holdMaxMs: 3000,
  finishWindowMinMs: 15_000,
  raceCapMaxMs: 4 * 3600_000,
  resultsLingerMs: 30_000,
  staleMs: 2000,
  awayMs: 6000,
  graceMs: 60_000,
  joinTimeoutMs: 10_000,
  roomLingerMs: 30_000,
  emptyRoomTtlMs: 10 * 60_000,
  maxRoomAgeMs: Number.POSITIVE_INFINITY,
};

const ms = int(0, 24 * 3600_000);
const timingsPatch: Check<Partial<RoomTimings>> = object(
  {},
  {
    readyCountdownMs: ms,
    gridTimeoutMs: ms,
    formationMs: ms,
    lightIntervalMs: int(50, 10_000),
    lightCount: int(1, 10),
    holdMinMs: ms,
    holdMaxMs: ms,
    finishWindowMinMs: ms,
    raceCapMaxMs: ms,
    resultsLingerMs: ms,
    staleMs: int(100, 600_000),
    awayMs: int(100, 600_000),
    graceMs: ms,
    joinTimeoutMs: int(100, 600_000),
    roomLingerMs: ms,
    emptyRoomTtlMs: ms,
    maxRoomAgeMs: int(60_000, 7 * 24 * 3600_000),
  },
);

/**
 * Read timing overrides from a JSON string (the service's ROOM_TIMINGS variable).
 * Empty or missing means the defaults.
 */
export function parseTimings(raw: unknown): Checked<RoomTimings> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: DEFAULT_TIMINGS };
  if (typeof raw !== 'string') return { ok: false, detail: 'timings must be a JSON string' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, detail: 'timings are not valid JSON' };
  }
  const r = timingsPatch(value, 'timings');
  if (!r.ok) return r;
  const t = { ...DEFAULT_TIMINGS, ...r.value };
  if (t.holdMaxMs < t.holdMinMs) return { ok: false, detail: 'holdMaxMs is below holdMinMs' };
  if (t.awayMs < t.staleMs) return { ok: false, detail: 'awayMs is below staleMs' };
  return { ok: true, value: t };
}

/** Message-rate and plausibility limits. Fixed; documented in docs/netcode.md. */
export const LIMITS = {
  /** Sockets in one room, joined or not (8 members, resumes and spectating slack). */
  maxSockets: 32,
  /** Sockets that have not joined yet, in one room and from one client address. */
  pendingPerRoom: 16,
  pendingPerAddress: 4,
  /** New sockets a room admits: burst, then per second. */
  admission: { capacity: 30, perSecond: 5 },
  /** Invalid or over-rate messages before the socket is closed. */
  maxStrikes: 10,
  /** One strike is forgiven per this long. */
  strikeDecayMs: 10_000,
  /** Token buckets per socket: burst capacity and sustained rate per second. */
  control: { capacity: 20, perSecond: 10 },
  snapshot: { capacity: 45, perSecond: 36 },
  ping: { capacity: 10, perSecond: 5 },
  /** A crossing needs a snapshot of that car within this long to count as evidenced. */
  evidenceWindowMs: 3000,
  /** No car covers ground faster than this, m/s (for the `s` progression check). */
  maxPlausibleSpeed: 120,
  /** Slack in metres on top of the speed bound. */
  evidenceSlackM: 50,
  /**
   * Race time is measured on the server clock (the client's synced estimate). A claim
   * may run this far ahead of the server's own elapsed race time, and its crossing
   * instant may differ from lights out plus its race time by this much: clock-sync
   * error, which is half a round trip.
   */
  raceClockAllowanceMs: 1000,
  /** A crossing's claimed server time may differ from its receipt by this much. */
  timestampToleranceMs: 10_000,
  /** Claimed and server-observed lap times may differ by max(this, 10 %) before a flag. */
  timeMismatchMinMs: 2000,
  timeMismatchFraction: 0.1,
  /** Sector times must add up to the lap time within this per sector, ms. */
  sectorSumToleranceMs: 2,
  /** Lap time must equal the race-time difference within this, ms. */
  raceTimeToleranceMs: 5,
  /** Moving faster than this before lights out is a jump start, m/s. */
  jumpSpeed: 1,
  jumpPenaltyMs: 5000,
  /** Track-limit warnings before each further one costs a penalty. */
  limitsFreeWarnings: 3,
  limitsPenaltyMs: 5000,
  /** Tokens of members who left, expired or were kicked, kept to answer resumes. */
  retiredTokens: 64,
  /** Disconnection windows kept per member for the crossing check. */
  outagesKept: 8,
} as const;
