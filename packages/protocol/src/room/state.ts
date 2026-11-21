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
  results: Results | null;
  closeAt: number | null;
  retiredTokens: RetiredToken[];
}
