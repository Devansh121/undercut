/**
 * Control messages (JSON text frames). Car snapshots are binary: see snapshot.ts.
 * Every client message is validated strictly by `parseClientMessage`, which never
 * throws and never coerces a value.
 */
import { RESUME_TOKEN } from './codes';
import type { ErrorCode, TimingReason } from './errors';
import { MAX_NAME_LENGTH } from './names';
import { MAX_CARS, settingsPatchCheck, type RoomSettings, type SettingsPatch } from './settings';
import type { CarSnapshot } from './snapshot';
import { arrayOf, bool, int, isPlainObject, num, object, oneOf, str, type Check } from './validate';

/** Bumped on any incompatible change to messages or frames. */
export const PROTOCOL_VERSION = 3;

/** Longest client text frame accepted, in UTF-16 units, checked before parsing. */
export const MAX_MESSAGE_LENGTH = 1024;

// ---- Shared views -------------------------------------------------------------

/**
 * lobby → grid → formation → lights → racing → finished → results → lobby.
 * `closed` is terminal.
 */
export const PHASES = [
  'lobby',
  'grid',
  'formation',
  'lights',
  'racing',
  'finished',
  'results',
  'closed',
] as const;
export type Phase = (typeof PHASES)[number];

/** `stale`: connected but no snapshots lately. `away`: disconnected or stale for long. */
export type MemberStatus = 'active' | 'stale' | 'away';

export interface MemberView {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  loaded: boolean;
  connected: boolean;
  status: MemberStatus;
}

export type CarState = 'racing' | 'finished' | 'dnf';

/** One car on the grid. The grid array is in grid order (pole first). */
export interface GridSlot {
  seat: number;
  kind: 'human' | 'ai';
  /** Member id for a human car, null for AI. */
  member: string | null;
  /** AI driver index (0-based) for an AI car, null for a human. */
  aiIndex: number | null;
  state: CarState;
}

export interface StartSchedule {
  /** Server time the first light comes on. */
  lightsStartAt: number;
  lightIntervalMs: number;
  lightCount: number;
  /** Server time all lights go out; the race clock starts here. */
  lightsOutAt: number;
}

export interface RoomView {
  code: string;
  phase: Phase;
  /** Server time the current phase times out, or null. */
  phaseEndsAt: number | null;
  host: string | null;
  settings: RoomSettings;
  members: MemberView[];
  /** Seats AI cars take if the race started now (lobby), or take (later phases). */
  aiSeats: number[];
  grid: GridSlot[] | null;
  start: StartSchedule | null;
  /** Server time the leader took the chequered flag, or null. */
  chequeredAt: number | null;
}

export type ResultStatus = 'finished' | 'running' | 'dnf';

export interface ResultRow {
  position: number;
  seat: number;
  kind: 'human' | 'ai';
  member: string | null;
  name: string | null;
  aiIndex: number | null;
  gridPosition: number;
  laps: number;
  /** Race time at the last counted crossing plus penalties, ms; null if no lap counted. */
  timeMs: number | null;
  penaltyMs: number;
  bestLapMs: number | null;
  status: ResultStatus;
  /** Reasons any of this car's laps were flagged. */
  flags: TimingReason[];
}

export interface Results {
  reason: 'complete' | 'time_cap';
  laps: number;
  rows: ResultRow[];
}

export interface AiHandover {
  /** Still owes the grid's initial timing-line crossing (older servers omit this). */
  behindLine?: boolean;
  seat: number;
  aiIndex: number;
  /** Laps counted and race time so far. */
  lap: number;
  raceMs: number;
  state: CarState;
  /** Last snapshot the server saw for this car, or null if none. */
  car: CarSnapshot | null;
}

// ---- Client to server -------------------------------------------------------

export interface JoinMessage {
  type: 'join';
  v: number;
  name: string;
  resume?: string;
}
export interface PingMessage {
  type: 'ping';
  id: number;
  /** Client clock at send, echoed back. */
  t: number;
}
export interface ReadyMessage {
  type: 'ready';
  ready: boolean;
}
export interface SettingsMessage {
  type: 'settings';
  patch: SettingsPatch;
}
export interface KickMessage {
  type: 'kick';
  member: string;
}
export interface LoadedMessage {
  type: 'loaded';
}
/** A line crossing: lap `lap` completed. */
export interface LapMessage {
  type: 'lap';
  seat: number;
  lap: number;
  lapMs: number;
  /** Race time at the crossing, from lights out, ms. */
  raceMs: number;
  sectorsMs?: number[];
  /** Evidence: the sender's sim tick, `s` and speed at the crossing. */
  tick: number;
  s: number;
  speed: number;
  /** Sender's estimate of server time at the crossing. */
  at: number;
}
export interface LimitsMessage {
  type: 'limits';
  seat: number;
  lap: number;
}
export interface JumpStartMessage {
  type: 'jump_start';
  seat: number;
}
export type PitEvent = 'entry' | 'box' | 'exit';
export interface PitMessage {
  type: 'pit';
  seat: number;
  event: PitEvent;
  lap: number;
  at: number;
}
export interface RetireMessage {
  type: 'retire';
  seat: number;
}
export interface RematchMessage {
  type: 'rematch';
}
export interface LeaveMessage {
  type: 'leave';
}

export type ClientMessage =
  | JoinMessage
  | PingMessage
  | ReadyMessage
  | SettingsMessage
  | KickMessage
  | LoadedMessage
  | LapMessage
  | LimitsMessage
  | JumpStartMessage
  | PitMessage
  | RetireMessage
  | RematchMessage
  | LeaveMessage;

export type ClientMessageType = ClientMessage['type'];

// ---- Server to client -------------------------------------------------------

export interface WelcomeMessage {
  type: 'welcome';
  v: number;
  /** The recipient's member id. */
  you: string;
  /** Keep this to resume the seat after a disconnect. */
  resume: string;
  seat: number;
  /** Server time snapshot `t` values are relative to on the wire. */
  epoch: number;
  /** Server time when this was sent. */
  now: number;
  room: RoomView;
  /** On a resume during a race: the last snapshot of your car and your counted progress. */
  car: CarSnapshot | null;
  progress: { lap: number; raceMs: number } | null;
}
export interface RoomMessage {
  type: 'room';
  room: RoomView;
}
export interface PongMessage {
  type: 'pong';
  id: number;
  t: number;
  /** Server time when the ping was handled. */
  now: number;
}
export interface StartMessage extends StartSchedule {
  type: 'start';
}
export interface TimingMessage {
  type: 'timing';
  seat: number;
  lap: number;
  lapMs: number;
  raceMs: number;
  sectorsMs: number[];
  status: 'accepted' | 'flagged' | 'rejected';
  reason: TimingReason | null;
}
export interface PenaltyMessage {
  type: 'penalty';
  seat: number;
  ms: number;
  reason: 'jump_start' | 'track_limits';
  totalMs: number;
}
export interface LimitsWarningMessage {
  type: 'limits';
  seat: number;
  lap: number;
  warnings: number;
}
export interface PitRelayMessage {
  type: 'pit';
  seat: number;
  event: PitEvent;
  lap: number;
  at: number;
}
export interface HostMessage {
  type: 'host';
  member: string;
  /** AI cars the new host now drives, with their last known state. */
  ai: AiHandover[];
}
export interface OrderMessage {
  type: 'order';
  /** Server time at which clients activate this order so every browser flips together. */
  at: number;
  /** Authoritative running order of every seat on the grid (leader first). */
  order: number[];
  /** Continuous race distance from the timing line per seat in `order` order, m. */
  progress: number[];
}
export interface ResultsMessage {
  type: 'results';
  results: Results;
}
export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  detail: string;
}

export type ServerMessage =
  | WelcomeMessage
  | RoomMessage
  | PongMessage
  | StartMessage
  | TimingMessage
  | PenaltyMessage
  | LimitsWarningMessage
  | PitRelayMessage
  | HostMessage
  | OrderMessage
  | ResultsMessage
  | ErrorMessage;

export type ServerMessageType = ServerMessage['type'];

// ---- Validation -------------------------------------------------------------

export interface ValidationError {
  code: ErrorCode;
  detail: string;
}

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: ValidationError };

const fail = (code: ErrorCode, detail: string): { ok: false; error: ValidationError } => ({
  ok: false,
  error: { code, detail },
});

const seat = int(0, MAX_CARS - 1);
const lapNo = int(1, 9999);
const serverTime = num(0, 1e14);
const memberId = str(16, /^m[0-9]{1,6}$/);

/** Field checks and the longest accepted frame, per message type. */
const SCHEMAS: { [K in ClientMessageType]: { maxLength: number; check: Check<unknown> } } = {
  join: {
    maxLength: 512,
    check: object(
      { type: str(8), v: num(-1e9, 1e9), name: str(MAX_NAME_LENGTH * 8) },
      { resume: str(32, RESUME_TOKEN) },
    ),
  },
  ping: {
    maxLength: 128,
    check: object({ type: str(8), id: int(0, 2 ** 31), t: num(-1e15, 1e15) }),
  },
  ready: { maxLength: 64, check: object({ type: str(8), ready: bool }) },
  settings: { maxLength: 1024, check: object({ type: str(8), patch: settingsPatchCheck }) },
  kick: { maxLength: 96, check: object({ type: str(8), member: memberId }) },
  loaded: { maxLength: 32, check: object({ type: str(8) }) },
  lap: {
    maxLength: 512,
    check: object(
      {
        type: str(8),
        seat,
        lap: lapNo,
        lapMs: int(1, 3_600_000),
        raceMs: int(1, 86_400_000),
        tick: int(0, 0xffffffff),
        s: num(0, 1e6),
        speed: num(0, 1000),
        at: serverTime,
      },
      { sectorsMs: arrayOf(int(0, 3_600_000), 8) },
    ),
  },
  limits: { maxLength: 96, check: object({ type: str(8), seat, lap: int(0, 9999) }) },
  jump_start: { maxLength: 64, check: object({ type: str(16), seat }) },
  pit: {
    maxLength: 160,
    check: object({
      type: str(8),
      seat,
      event: oneOf<PitEvent>(['entry', 'box', 'exit']),
      lap: int(0, 9999),
      at: serverTime,
    }),
  },
  retire: { maxLength: 64, check: object({ type: str(8), seat }) },
  rematch: { maxLength: 32, check: object({ type: str(8) }) },
  leave: { maxLength: 32, check: object({ type: str(8) }) },
};

const isClientType = (type: string): type is ClientMessageType => Object.hasOwn(SCHEMAS, type);

/** Parse and validate one text frame from a client. Never throws. */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  try {
    if (typeof raw !== 'string') return fail('bad_message', 'only text frames carry JSON');
    if (raw.length > MAX_MESSAGE_LENGTH) {
      return fail('too_large', `messages are limited to ${MAX_MESSAGE_LENGTH} characters`);
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return fail('bad_json', 'message is not valid JSON');
    }
    if (!isPlainObject(value)) return fail('bad_message', 'message must be a JSON object');
    // Check the type before using it: never coerce a client value to a string.
    const type = value.type;
    if (typeof type !== 'string') return fail('bad_message', 'type must be a string');
    if (!isClientType(type)) {
      return fail('unknown_type', `unknown message type: ${JSON.stringify(type.slice(0, 32))}`);
    }
    const schema = SCHEMAS[type];
    if (raw.length > schema.maxLength) {
      return fail('too_large', `${type} messages are limited to ${schema.maxLength} characters`);
    }
    const checked = schema.check(value, type);
    if (!checked.ok) return fail('bad_message', checked.detail);
    const message = checked.value as ClientMessage;
    if (message.type === 'join' && message.v !== PROTOCOL_VERSION) {
      return fail('version_mismatch', `server speaks protocol ${PROTOCOL_VERSION}`);
    }
    return { ok: true, message };
  } catch {
    return fail('internal_error', 'the message could not be checked');
  }
}

/** Serialise a client message for the wire. */
export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

/** Serialise a server message for the wire. */
export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

const SERVER_TYPES: ReadonlySet<string> = new Set<ServerMessageType>([
  'welcome',
  'room',
  'pong',
  'start',
  'timing',
  'penalty',
  'limits',
  'pit',
  'host',
  'order',
  'results',
  'error',
]);

/**
 * Parse a server frame on the client. The server is trusted for field contents, so this
 * checks only that the frame is a JSON object with a known `type`. Never throws.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isPlainObject(value) || typeof value.type !== 'string') return null;
    return SERVER_TYPES.has(value.type) ? (value as unknown as ServerMessage) : null;
  } catch {
    return null;
  }
}
