/** The room's plain-data state: what the service persists between events. */
import type { TimingReason } from '../errors';
import type { CarState, MemberStatus, Phase, Results, StartSchedule } from '../messages';
import type { RoomSettings } from '../settings';

export interface Bucket {
  tokens: number;
  at: number;
}

export interface ConnState {
  id: string;
  /** Client address the socket came from (per-address limits on unjoined sockets). */
  address: string;
  /** Member this socket speaks for, once joined. */
  member: string | null;
  openedAt: number;
  strikes: number;
  strikeAt: number;
  control: Bucket;
  snapshot: Bucket;
  ping: Bucket;
  /** Last time a rate_limited error was sent, so a flood gets one reply a second. */
  rateErrorAt: number;
}

export interface Member {
  id: string;
  name: string;
  seat: number;
  token: string;
  ready: boolean;
  loaded: boolean;
  conn: string | null;
  joinedAt: number;
  /** Start of the current connection; orders host succession. Null while disconnected. */
  connectedSince: number | null;
  /** When the seat is lost unless the member comes back. */
  graceUntil: number | null;
  status: MemberStatus;
  lastSnapshotAt: number | null;
  /** Recent disconnection windows [from, to]; `to` is null while still disconnected. */
  outages: [number, number | null][];
}

/** One counted line crossing. */
export interface Crossing {
  lap: number;
  /** Race time at the crossing, ms (server clock, from lights out). */
  raceMs: number;
  lapMs: number;
  /** Laps since the previous counted crossing (more than 1 after a rejected claim). */
  gap: number;
  /** Server time the claim arrived. */
  receivedAt: number;
  flag: TimingReason | null;
}

export interface CarRecord {
  seat: number;
  kind: 'human' | 'ai';
  member: string | null;
  aiIndex: number | null;
  /** Name at grid time, kept for the results even if the member leaves. */
  name: string | null;
  gridPosition: number;
  state: CarState;
  /** Laps counted. */
  lap: number;
  /** Race time at the last counted crossing, ms. */
  raceMs: number;
  /** Server time the last counted crossing arrived. */
  lastCrossAt: number | null;
  bestLapMs: number | null;
  penaltyMs: number;
  warnings: number;
  jumpStart: boolean;
  /**
   * Counted crossings in order. lap, raceMs, lastCrossAt, bestLapMs and flags are
   * derived from these (see deriveProgress), so a later, earlier flag can cut them.
   */
  crossings: Crossing[];
  /** Laps with a track-limit report (their times do not count for best lap). */
  invalidLaps: number[];
  flags: TimingReason[];
}

export interface RetiredToken {
  token: string;
  why: 'left' | 'expired' | 'kicked';
}

export interface RoomState {
  /** Stored-state format version. */
  format: 1;
  code: string;
  /** Server time snapshot times are relative to on the wire. */
  epoch: number;
  createdAt: number;
  phase: Phase;
  phaseEndsAt: number | null;
  settings: RoomSettings;
  host: string | null;
  nextMember: number;
  nextAi: number;
  members: Member[];
  conns: ConnState[];
  /** Grid order, from the grid phase until back in the lobby. */
  cars: CarRecord[] | null;
  start: StartSchedule | null;
  chequeredAt: number | null;
  /**
   * Race time of the leader's finishing crossing. A car takes the flag on its first
   * crossing at or after this race time: decided on the clients' own race clocks, so
   * the order messages arrive in does not matter.
   */
  chequerRaceMs: number | null;
  results: Results | null;
  closeAt: number | null;
  retiredTokens: RetiredToken[];
}
