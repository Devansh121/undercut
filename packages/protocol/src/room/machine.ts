/**
 * The room as a pure state machine. The service feeds it socket events and alarm ticks
 * with the current server time and sends what it returns; it does no I/O, reads no
 * clock and draws randomness only from the injected `RoomDeps`. Everything a room
 * decides (phases, seats, host, start schedule, timing verdicts, results, limits) is
 * here, so it runs and is tested in Node without the Workers runtime.
 */
import { normalizeRoomCode } from '../codes';
import { CLOSE, type ErrorCode, type TimingReason } from '../errors';
import {
  PROTOCOL_VERSION,
  encodeServerMessage,
  parseClientMessage,
  type AiHandover,
  type ClientMessage,
  type ClientMessageType,
  type GridSlot,
  type LapMessage,
  type Phase,
  type RoomView,
  type ServerMessage,
} from '../messages';
import { sanitizeName } from '../names';
import {
  DEFAULT_SETTINGS,
  MAX_CARS,
  MAX_HUMANS,
  applySettingsPatch,
  type RoomSettings,
} from '../settings';
import {
  MAX_UP_FRAME_BYTES,
  decodeUpFrame,
  encodeDownFrame,
  snapshotSpeed,
  type CarSnapshot,
} from '../snapshot';
import { classify } from './classification';
import { DEFAULT_TIMINGS, LIMITS, type RoomTimings } from './rules';
import type { Bucket, CarRecord, ConnState, Member, RoomState } from './state';
import { judgeLap } from './timing';

/** Randomness the room needs. The service backs both with `crypto.getRandomValues`. */
export interface RoomDeps {
  /** Uniform integer in [0, n). */
  randomInt(n: number): number;
  /** A fresh resume token (32 lower-case hex digits). */
  token(): string;
}

export type RoomEvent =
  /** `address` is the client's address as the service sees it (for per-address limits). */
  | { type: 'open'; conn: string; address: string }
  | { type: 'text'; conn: string; data: string }
  | { type: 'binary'; conn: string; data: Uint8Array }
  | { type: 'close'; conn: string }
  | { type: 'tick' };

/** What the service must do. Text is already encoded, so a broadcast encodes once. */
export type Outbound =
  | { kind: 'text'; to: string; text: string }
  | { kind: 'binary'; to: readonly string[]; data: Uint8Array }
  | { kind: 'close'; to: string; code: number; reason: string };

export interface RoomInfo {
  code: string;
  phase: Phase;
  humans: number;
  maxHumans: number;
  joinable: boolean;
}

/** Per-seat snapshot bookkeeping. Memory only: lost on eviction, rebuilt within a tick. */
interface SeatTrack {
  tick: number;
  snap: CarSnapshot;
  at: number;
}

/** Which client messages each phase accepts (join, ping and leave are always accepted). */
export const PHASE_ACCEPTS: { readonly [P in Phase]: ReadonlySet<ClientMessageType> } = {
  lobby: new Set(['ready', 'settings', 'kick']),
  grid: new Set(['kick', 'loaded', 'retire']),
  formation: new Set(['kick', 'loaded', 'jump_start', 'retire']),
  lights: new Set(['kick', 'loaded', 'jump_start', 'retire']),
  racing: new Set(['kick', 'loaded', 'jump_start', 'retire', 'lap', 'limits', 'pit']),
  finished: new Set(['kick', 'retire', 'lap', 'limits', 'pit']),
  results: new Set(['kick', 'rematch']),
  closed: new Set(),
};

const ALWAYS: ReadonlySet<ClientMessageType> = new Set(['join', 'ping', 'leave']);
const ON_TRACK: ReadonlySet<Phase> = new Set(['formation', 'lights', 'racing', 'finished']);
const SNAPSHOT_PHASES: ReadonlySet<Phase> = new Set([
  'grid',
  'formation',
  'lights',
  'racing',
  'finished',
]);

const bucket = (now: number, tokens: number): Bucket => ({ tokens, at: now });

function take(b: Bucket, rule: { capacity: number; perSecond: number }, now: number): boolean {
  b.tokens = Math.min(rule.capacity, b.tokens + (Math.max(0, now - b.at) / 1000) * rule.perSecond);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export class RoomMachine {
  private readonly seats = new Map<number, SeatTrack>();
  /** Room-wide admission bucket. Memory only. */
  private readonly admission: Bucket = { tokens: LIMITS.admission.capacity, at: 0 };
  private out: Outbound[] = [];
  private now = 0;
  private dirty = true;

  private constructor(
    readonly state: RoomState,
    private readonly deps: RoomDeps,
    readonly timings: RoomTimings,
  ) {}

  /** A new, empty room. It closes if nobody joins within `emptyRoomTtlMs`. */
  static create(
    code: string,
    now: number,
    deps: RoomDeps,
    timings: RoomTimings = DEFAULT_TIMINGS,
    settings: RoomSettings = DEFAULT_SETTINGS,
  ): RoomMachine {
    const canonical = normalizeRoomCode(code);
    if (canonical === null) throw new Error('invalid room code');
    return new RoomMachine(
      {
        format: 1,
        code: canonical,
        epoch: Math.floor(now),
        createdAt: now,
        phase: 'lobby',
        phaseEndsAt: null,
        settings,
        host: null,
        nextMember: 1,
        nextAi: 0,
        members: [],
        conns: [],
        cars: null,
        start: null,
        chequeredAt: null,
        chequerRaceMs: null,
        results: null,
        closeAt: now + timings.emptyRoomTtlMs,
        retiredTokens: [],
      },
      deps,
      timings,
    );
  }

  /** Rebuild from persisted state (after eviction or a restart). */
  static restore(state: RoomState, deps: RoomDeps, timings: RoomTimings = DEFAULT_TIMINGS) {
    return new RoomMachine(JSON.parse(JSON.stringify(state)) as RoomState, deps, timings);
  }

  /** True once if the persisted state changed since the last call. */
  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  get closed(): boolean {
    return this.state.phase === 'closed';
  }

  /**
   * Must a state write be durable before anything else is sent? Yes in the lobby and
   * results (and when closing), where the room promises to survive eviction. Not while
   * cars are on track: there a write may be lost on eviction, which is better than
   * holding every snapshot relay until the disk confirms it.
   */
  get durableWrites(): boolean {
    return !SNAPSHOT_PHASES.has(this.state.phase);
  }

  info(): RoomInfo {
    const humans = this.state.members.length;
    return {
      code: this.state.code,
      phase: this.state.phase,
      humans,
      maxHumans: MAX_HUMANS,
      joinable:
        (this.state.phase === 'lobby' || this.state.phase === 'results') && humans < MAX_HUMANS,
    };
  }

  /** Last snapshot the server holds for a seat. */
  lastSnapshot(seat: number): CarSnapshot | null {
    return this.seats.get(seat)?.snap ?? null;
  }

  /** Handle one event at server time `now`. Never throws on any client input. */
  handle(event: RoomEvent, now: number): Outbound[] {
    this.now = Math.max(this.now, now);
    this.out = [];
    this.advance();
    switch (event.type) {
      case 'open':
        this.onOpen(event.conn, event.address);
        break;
      case 'text':
        this.onText(event.conn, event.data);
        break;
      case 'binary':
        this.onBinary(event.conn, event.data);
        break;
      case 'close':
        this.onClose(event.conn);
        break;
      case 'tick':
        break;
    }
    this.advance();
    return this.out;
  }

  /** Earliest server time the room needs a tick, or null if it can sleep. */
  nextWakeAt(): number | null {
    const s = this.state;
    if (s.phase === 'closed') return null;
    let t = Number.POSITIVE_INFINITY;
    const at = (v: number | null) => {
      if (v !== null && v < t) t = v;
    };
    at(s.phaseEndsAt);
    at(s.closeAt);
    if (s.phase === 'lobby') at(s.createdAt + this.timings.maxRoomAgeMs);
    for (const m of s.members) at(m.graceUntil);
    for (const c of s.conns) if (c.member === null) at(c.openedAt + this.timings.joinTimeoutMs);
    // Staleness is checked by polling while cars are on track.
    if (ON_TRACK.has(s.phase)) at(this.now + Math.min(500, this.timings.staleMs / 2));
    return Number.isFinite(t) ? t : null;
  }

  view(): RoomView {
    const s = this.state;
    return {
      code: s.code,
      phase: s.phase,
      phaseEndsAt: s.phaseEndsAt,
      host: s.host,
      settings: s.settings,
      members: s.members.map((m) => ({
        id: m.id,
        name: m.name,
        seat: m.seat,
        ready: m.ready,
        loaded: m.loaded,
        connected: m.conn !== null,
        status: m.status,
      })),
      aiSeats: s.cars
        ? s.cars.filter((c) => c.kind === 'ai').map((c) => c.seat)
        : this.lobbyAiSeats(),
      grid: s.cars ? s.cars.map(gridSlot) : null,
      start: s.start,
      chequeredAt: s.chequeredAt,
    };
  }

  // ---- Output helpers ---------------------------------------------------------

  private sendTo(conn: string, message: ServerMessage): void {
    this.out.push({ kind: 'text', to: conn, text: encodeServerMessage(message) });
  }

  private joinedConns(except?: string): string[] {
    return this.state.conns.filter((c) => c.member !== null && c.id !== except).map((c) => c.id);
  }

  private broadcast(message: ServerMessage, except?: string): void {
    const text = encodeServerMessage(message);
    for (const to of this.joinedConns(except)) this.out.push({ kind: 'text', to, text });
  }

  private broadcastRoom(): void {
    this.dirty = true;
    this.broadcast({ type: 'room', room: this.view() });
  }

  private error(conn: string, code: ErrorCode, detail: string): void {
    this.sendTo(conn, { type: 'error', code, detail });
  }

  private closeConn(conn: string, code: number, reason: string): void {
    this.out.push({ kind: 'close', to: conn, code, reason });
    const c = this.conn(conn);
    if (c) this.dropConn(c);
  }

  // ---- Lookups ------------------------------------------------------------------

  private conn(id: string): ConnState | undefined {
    return this.state.conns.find((c) => c.id === id);
  }

  private member(id: string | null): Member | undefined {
    return id === null ? undefined : this.state.members.find((m) => m.id === id);
  }

  private car(seat: number): CarRecord | undefined {
    return this.state.cars?.find((c) => c.seat === seat);
  }

  private lobbyAiSeats(): number[] {
    const taken = new Set(this.state.members.map((m) => m.seat));
    const n = Math.min(this.state.settings.aiCount, MAX_CARS - this.state.members.length);
    const seats: number[] = [];
    for (let seat = 0; seat < MAX_CARS && seats.length < n; seat++) {
      if (!taken.has(seat)) seats.push(seat);
    }
    return seats;
  }

  /** Does `member` drive the car in `seat` right now? Humans their own, the host the AI. */
  private owns(member: Member, seat: number): boolean {
    const car = this.car(seat);
    if (!car) return false;
    return car.kind === 'human' ? car.member === member.id : this.state.host === member.id;
  }

  // ---- Clock -----------------------------------------------------------------

  /** Apply every deadline that has passed. Runs before and after each event. */
  private advance(): void {
    const s = this.state;
    for (let guard = 0; guard < 16 && s.phase !== 'closed'; guard++) {
      const now = this.now;
      let changed = false;
      for (const c of [...s.conns]) {
        if (c.member === null && now >= c.openedAt + this.timings.joinTimeoutMs) {
          this.closeConn(c.id, CLOSE.joinTimeout, 'no join message');
        }
      }
      for (const m of [...s.members]) {
        if (m.graceUntil !== null && now >= m.graceUntil) {
          this.retireToken(m.token, 'expired');
          if (m.conn !== null) this.error(m.conn, 'resume_expired', 'away too long; seat given up');
          this.evict(m, CLOSE.resumeExpired, 'resume_expired');
          changed = true;
        }
      }
      if (ON_TRACK.has(s.phase)) changed = this.updateStaleness() || changed;
      if (s.closeAt !== null && now >= s.closeAt) {
        this.closeRoom();
        return;
      }
      if (s.phase === 'lobby' && now >= s.createdAt + this.timings.maxRoomAgeMs) {
        this.closeRoom();
        return;
      }
      if (s.phaseEndsAt !== null && now >= s.phaseEndsAt) {
        this.onPhaseTimeout();
        continue;
      }
      if (changed) this.broadcastRoom();
      break;
    }
  }

  /**
   * A member is watched while anything they drive is racing: their own car, and for the
   * host every AI car too, even after the host's own car has finished or retired. Only
   * snapshots count as signs of life: a hidden tab keeps its socket and its (throttled)
   * timers, so it keeps pinging, but it stops rendering frames and so stops driving.
   */
  private drivesRacingCar(m: Member): boolean {
    const cars = this.state.cars ?? [];
    return cars.some(
      (c) =>
        c.state === 'racing' && (c.kind === 'human' ? c.member === m.id : this.state.host === m.id),
    );
  }

  private updateStaleness(): boolean {
    let changed = false;
    for (const m of this.state.members) {
      if (m.conn === null || m.lastSnapshotAt === null) continue;
      if (!this.drivesRacingCar(m)) continue;
      const silent = this.now - m.lastSnapshotAt;
      if (silent >= this.timings.awayMs && m.status !== 'away') {
        m.status = 'away';
        m.graceUntil = this.now + this.timings.graceMs;
        changed = true;
      } else if (silent >= this.timings.staleMs && m.status === 'active') {
        m.status = 'stale';
        changed = true;
      }
    }
    if (changed) this.ensureHost();
    return changed;
  }

  private onPhaseTimeout(): void {
    const s = this.state;
    s.phaseEndsAt = null;
    this.dirty = true;
    switch (s.phase) {
      case 'lobby':
        if (this.allReady()) this.enterGrid();
        else this.broadcastRoom();
        break;
      case 'grid':
        this.enterFormation();
        break;
      case 'formation':
        s.phase = 'lights';
        s.phaseEndsAt = s.start?.lightsOutAt ?? this.now;
        this.broadcastRoom();
        break;
      case 'lights': {
        s.phase = 'racing';
        const cap = Math.min(
          s.settings.laps * s.settings.circuit.maxLapMs,
          this.timings.raceCapMaxMs,
        );
        s.phaseEndsAt = (s.start?.lightsOutAt ?? this.now) + cap;
        this.broadcastRoom();
        this.checkRaceEnd();
        break;
      }
      case 'racing':
        this.finish('time_cap');
        break;
      case 'finished':
        this.finish('complete');
        break;
      case 'results':
        this.toLobby();
        break;
      case 'closed':
        break;
    }
  }

  // ---- Phases ------------------------------------------------------------------

  private allReady(): boolean {
    const ms = this.state.members;
    return ms.length > 0 && ms.every((m) => m.ready && m.conn !== null);
  }

  /** Start or cancel the ready countdown after anything that may change readiness. */
  private updateCountdown(): void {
    const s = this.state;
    if (s.phase !== 'lobby') return;
    if (this.allReady()) {
      s.phaseEndsAt ??= this.now + this.timings.readyCountdownMs;
    } else {
      s.phaseEndsAt = null;
    }
  }

  private enterGrid(): void {
    const s = this.state;
    const humans = [...s.members].sort((a, b) => a.joinedAt - b.joinedAt);
    const cars: CarRecord[] = humans.map((m) => newCar(m.seat, 'human', m.id, null, m.name));
    for (const seat of this.lobbyAiSeats()) cars.push(newCar(seat, 'ai', null, s.nextAi++, null));
    if (s.settings.gridOrder === 'random') {
      for (let i = cars.length - 1; i > 0; i--) {
        const j = this.deps.randomInt(i + 1);
        [cars[i], cars[j]] = [cars[j] as CarRecord, cars[i] as CarRecord];
      }
    }
    cars.forEach((c, i) => (c.gridPosition = i + 1));
    s.cars = cars;
    s.results = null;
    s.phase = 'grid';
    s.phaseEndsAt = this.now + this.timings.gridTimeoutMs;
    for (const m of s.members) m.loaded = false;
    this.seats.clear();
    this.broadcastRoom();
  }

  private checkAllLoaded(): void {
    const s = this.state;
    if (s.phase !== 'grid') return;
    const connected = s.members.filter((m) => m.conn !== null);
    if (connected.every((m) => m.loaded)) this.enterFormation();
  }

  private enterFormation(): void {
    const s = this.state;
    const t = this.timings;
    const hold = t.holdMinMs + this.deps.randomInt(t.holdMaxMs - t.holdMinMs + 1);
    const lightsStartAt = this.now + t.formationMs;
    s.start = {
      lightsStartAt,
      lightIntervalMs: t.lightIntervalMs,
      lightCount: t.lightCount,
      lightsOutAt: lightsStartAt + (t.lightCount - 1) * t.lightIntervalMs + hold,
    };
    s.phase = 'formation';
    s.phaseEndsAt = lightsStartAt;
    for (const m of s.members) {
      m.lastSnapshotAt = this.now;
      if (m.conn !== null) m.status = 'active';
    }
    this.broadcast({ type: 'start', ...s.start });
    this.broadcastRoom();
  }

  /**
   * The chequered flag, derived from every counted crossing so the order claims arrive
   * in cannot change it. The flag falls at the earliest race time any car completed the
   * distance; each car finishes on its first counted crossing at or after that race
   * time, and crossings it reported after that are not counted. A late claim of an
   * earlier finish moves the flag earlier, and every car is judged again. Returns
   * whether any car's state changed.
   */
  private resolveFlag(): boolean {
    const s = this.state;
    const cars = s.cars;
    if (!cars || (s.phase !== 'racing' && s.phase !== 'finished')) return false;
    let flag: number | null = null;
    for (const c of cars) {
      for (const x of c.crossings) {
        if (x.lap >= s.settings.laps && (flag === null || x.raceMs < flag)) flag = x.raceMs;
      }
    }
    if (flag === null) return false;
    let changed = false;
    if (s.phase === 'racing') {
      s.phase = 'finished';
      s.chequeredAt = this.now;
      const window = Math.min(
        Math.max(this.timings.finishWindowMinMs, 2 * s.settings.circuit.minLapMs),
        s.settings.circuit.maxLapMs,
      );
      s.phaseEndsAt = this.now + window;
      changed = true;
    }
    s.chequerRaceMs = flag;
    for (const c of cars) {
      const at = c.crossings.findIndex((x) => x.raceMs >= (flag as number));
      if (at < 0) continue;
      if (c.crossings.length > at + 1) {
        c.crossings.length = at + 1;
        deriveProgress(c);
      }
      // Took the flag; a car that retired after crossing it still finished.
      if (c.state !== 'finished') {
        c.state = 'finished';
        changed = true;
      }
    }
    if (changed) this.dirty = true;
    return changed;
  }

  private checkRaceEnd(): void {
    const s = this.state;
    if (s.phase !== 'racing' && s.phase !== 'finished') return;
    if (!s.cars?.some((c) => c.state === 'racing')) this.finish('complete');
  }

  private finish(reason: 'complete' | 'time_cap'): void {
    const s = this.state;
    s.results = classify(s.cars ?? [], s.settings.laps, reason);
    s.phase = 'results';
    s.phaseEndsAt = this.now + this.timings.resultsLingerMs;
    this.broadcast({ type: 'results', results: s.results });
    this.broadcastRoom();
  }

  private toLobby(): void {
    const s = this.state;
    s.phase = 'lobby';
    s.phaseEndsAt = null;
    s.cars = null;
    s.start = null;
    s.chequeredAt = null;
    s.chequerRaceMs = null;
    for (const m of s.members) {
      m.ready = false;
      m.loaded = false;
      m.lastSnapshotAt = null;
      if (m.conn !== null) m.status = 'active';
    }
    this.seats.clear();
    this.ensureHost();
    this.broadcastRoom();
  }

  private closeRoom(): void {
    const s = this.state;
    for (const c of [...s.conns]) {
      this.error(c.id, 'room_closed', 'the room has closed');
      this.closeConn(c.id, CLOSE.roomClosed, 'room closed');
    }
    s.phase = 'closed';
    s.phaseEndsAt = null;
    s.closeAt = null;
    this.dirty = true;
  }

  // ---- Host --------------------------------------------------------------------

  /** Keep a reachable host: promote the longest-connected active human if needed. */
  private ensureHost(): void {
    const s = this.state;
    const current = this.member(s.host);
    const eligible = (m: Member) => m.conn !== null && m.status !== 'away';
    if (current && eligible(current)) return;
    const candidates = s.members
      .filter(eligible)
      .sort((a, b) => (a.connectedSince ?? 0) - (b.connectedSince ?? 0) || a.joinedAt - b.joinedAt);
    const next = candidates[0] ?? (current ? undefined : s.members[0]);
    if (!next) {
      if (!current) s.host = null;
      return;
    }
    if (next.id === s.host) return;
    s.host = next.id;
    this.dirty = true;
    this.broadcast({ type: 'host', member: next.id, ai: this.aiHandover() });
  }

  private aiHandover(): AiHandover[] {
    const cars = this.state.cars ?? [];
    return cars
      .filter((c) => c.kind === 'ai')
      .map((c) => ({
        seat: c.seat,
        aiIndex: c.aiIndex ?? 0,
        lap: c.lap,
        raceMs: c.raceMs,
        state: c.state,
        car: this.seats.get(c.seat)?.snap ?? null,
      }));
  }

  // ---- Members -----------------------------------------------------------------

  private retireToken(token: string, why: 'left' | 'expired' | 'kicked'): void {
    const list = this.state.retiredTokens;
    list.push({ token, why });
    if (list.length > LIMITS.retiredTokens) list.splice(0, list.length - LIMITS.retiredTokens);
  }

  /**
   * Take a member out of the room. Their car: before the start it becomes an AI car the
   * host drives (the grid stays full); once racing it retires (DNF); in the lobby and
   * results the seat is simply free.
   */
  private removeMember(m: Member): void {
    const s = this.state;
    s.members = s.members.filter((x) => x !== m);
    if (m.conn !== null) {
      const c = this.conn(m.conn);
      if (c) c.member = null;
    }
    const car = s.cars?.find((c) => c.member === m.id);
    let aiChanged = false;
    if (car) {
      if (s.phase === 'grid' || s.phase === 'formation' || s.phase === 'lights') {
        car.kind = 'ai';
        car.member = null;
        car.aiIndex = s.nextAi++;
        car.name = null;
        aiChanged = true;
      } else if (s.phase === 'racing' || s.phase === 'finished') {
        if (car.state === 'racing') car.state = 'dnf';
      }
    }
    this.dirty = true;
    const hostBefore = s.host;
    if (s.host === m.id) s.host = null;
    this.ensureHost();
    if (aiChanged && s.host !== null && s.host === hostBefore) {
      // Same host, one more AI car: tell everyone (the host picks it up).
      this.broadcast({ type: 'host', member: s.host, ai: this.aiHandover() });
    }
    if (s.members.length === 0) s.closeAt = this.now + this.timings.roomLingerMs;
    this.updateCountdown();
    this.checkAllLoaded();
    this.checkRaceEnd();
    if (s.phase !== 'closed') this.broadcastRoom();
  }

  /** Close the member's socket (if any) without a grace period and remove them. */
  private evict(m: Member, code: number, reason: string): void {
    if (m.conn !== null) {
      const c = this.conn(m.conn);
      this.out.push({ kind: 'close', to: m.conn, code, reason });
      if (c) this.state.conns = this.state.conns.filter((x) => x !== c);
      m.conn = null;
    }
    this.removeMember(m);
  }

  private disconnect(m: Member): void {
    m.conn = null;
    m.connectedSince = null;
    m.status = 'away';
    m.graceUntil = this.now + this.timings.graceMs;
    m.outages.push([this.now, null]);
    if (m.outages.length > LIMITS.outagesKept) m.outages.shift();
    this.dirty = true;
    this.ensureHost();
    this.updateCountdown();
    this.checkAllLoaded();
    this.broadcastRoom();
  }

  // ---- Socket events -------------------------------------------------------------

  /** Why a new socket from `address` cannot be taken now, or null if it can. */
  private refusal(address: string): 'room_closed' | 'busy' | null {
    const s = this.state;
    if (s.phase === 'closed') return 'room_closed';
    if (s.conns.length >= LIMITS.maxSockets) return 'busy';
    const pending = s.conns.filter((c) => c.member === null);
    if (pending.length >= LIMITS.pendingPerRoom) return 'busy';
    if (pending.filter((c) => c.address === address).length >= LIMITS.pendingPerAddress) {
      return 'busy';
    }
    return null;
  }

  /**
   * May a socket from `address` open now? The service asks before it accepts the
   * WebSocket upgrade. Limits sockets in the room, sockets that have not joined (room-wide
   * and per address), and the rate the room admits them. A yes uses one admission token.
   */
  admit(
    address: string,
    now: number,
  ): { ok: true } | { ok: false; reason: 'room_closed' | 'busy' } {
    // Reads the state as it is and runs no deadlines: anything due is handled, and its
    // messages sent, by the `open` event that follows.
    const reason = this.refusal(address);
    if (reason) return { ok: false, reason };
    if (!take(this.admission, LIMITS.admission, Math.max(this.now, now))) {
      return { ok: false, reason: 'busy' };
    }
    return { ok: true };
  }

  private onOpen(id: string, address: string): void {
    const reason = this.refusal(address);
    if (reason === 'room_closed') {
      this.out.push({ kind: 'close', to: id, code: CLOSE.roomClosed, reason: 'room closed' });
      return;
    }
    if (reason === 'busy') {
      this.out.push({ kind: 'close', to: id, code: CLOSE.busy, reason: 'busy' });
      return;
    }
    this.register(id, address);
  }

  /**
   * Track a socket. Not persisted until it joins: an unjoined socket is cheap to lose,
   * and a flood of them must not turn into storage writes.
   */
  private register(id: string, address: string): ConnState {
    const c: ConnState = {
      id,
      address,
      member: null,
      openedAt: this.now,
      strikes: 0,
      strikeAt: this.now,
      control: bucket(this.now, LIMITS.control.capacity),
      snapshot: bucket(this.now, LIMITS.snapshot.capacity),
      ping: bucket(this.now, LIMITS.ping.capacity),
      rateErrorAt: -1e15,
    };
    this.state.conns.push(c);
    return c;
  }

  private dropConn(c: ConnState): void {
    this.state.conns = this.state.conns.filter((x) => x !== c);
    this.dirty = true;
    const m = this.member(c.member);
    if (m && m.conn === c.id) this.disconnect(m);
  }

  private onClose(id: string): void {
    const c = this.conn(id);
    if (c) this.dropConn(c);
  }

  /** Count an offence; close the socket after too many. Returns false if closed. */
  private strike(c: ConnState): boolean {
    const decay = Math.floor((this.now - c.strikeAt) / LIMITS.strikeDecayMs);
    if (decay > 0) {
      c.strikes = Math.max(0, c.strikes - decay);
      c.strikeAt = this.now;
    }
    c.strikes += 1;
    if (c.strikes === 1) c.strikeAt = this.now;
    if (c.strikes >= LIMITS.maxStrikes) {
      this.error(c.id, 'too_many_strikes', 'too many invalid messages');
      this.closeConn(c.id, CLOSE.tooManyStrikes, 'too many invalid messages');
      return false;
    }
    return true;
  }

  private rateLimited(c: ConnState, what: string): void {
    if (!this.strike(c)) return;
    if (this.now - c.rateErrorAt >= 1000) {
      c.rateErrorAt = this.now;
      this.error(c.id, 'rate_limited', `too many ${what} messages`);
    }
  }

  private onText(id: string, data: string): void {
    if (this.state.phase === 'closed') return;
    const c = this.conn(id) ?? this.register(id, 'unknown');
    const parsed = parseClientMessage(data);
    if (!parsed.ok) {
      if (parsed.error.code === 'version_mismatch') {
        // A client on another protocol version cannot do anything useful here.
        this.error(id, parsed.error.code, parsed.error.detail);
        this.closeConn(id, CLOSE.versionMismatch, 'version_mismatch');
        return;
      }
      if (this.strike(c)) this.error(id, parsed.error.code, parsed.error.detail);
      return;
    }
    const msg = parsed.message;
    const rule = msg.type === 'ping' ? LIMITS.ping : LIMITS.control;
    if (!take(msg.type === 'ping' ? c.ping : c.control, rule, this.now)) {
      this.rateLimited(c, msg.type === 'ping' ? 'ping' : 'control');
      return;
    }
    if (msg.type === 'join') {
      this.onJoin(c, msg);
      return;
    }
    const m = this.member(c.member);
    if (!m) {
      if (this.strike(c)) this.error(id, 'not_joined', 'send join first');
      return;
    }
    if (!ALWAYS.has(msg.type) && !PHASE_ACCEPTS[this.state.phase].has(msg.type)) {
      this.error(id, 'wrong_phase', `${msg.type} is not accepted in the ${this.state.phase} phase`);
      return;
    }
    this.dispatch(c, m, msg);
  }

  private dispatch(c: ConnState, m: Member, msg: ClientMessage): void {
    const s = this.state;
    switch (msg.type) {
      case 'join':
        return;
      case 'ping':
        this.sendTo(c.id, { type: 'pong', id: msg.id, t: msg.t, now: this.now });
        return;
      case 'leave':
        this.retireToken(m.token, 'left');
        this.evict(m, CLOSE.left, 'left');
        return;
      case 'ready':
        if (m.ready !== msg.ready) {
          m.ready = msg.ready;
          this.updateCountdown();
          this.broadcastRoom();
        }
        return;
      case 'settings': {
        if (s.host !== m.id) return this.error(c.id, 'not_host', 'only the host changes settings');
        const next = applySettingsPatch(s.settings, msg.patch);
        if (!next.ok) return this.error(c.id, 'bad_settings', next.detail);
        s.settings = next.value;
        for (const x of s.members) x.ready = false;
        this.updateCountdown();
        this.broadcastRoom();
        return;
      }
      case 'kick': {
        if (s.host !== m.id) return this.error(c.id, 'not_host', 'only the host kicks');
        const target = this.member(msg.member);
        if (!target || target === m) {
          return this.error(c.id, 'no_such_member', 'no such member to kick');
        }
        this.retireToken(target.token, 'kicked');
        if (target.conn !== null) {
          this.error(target.conn, 'kicked', 'the host removed you from the room');
        }
        this.evict(target, CLOSE.kicked, 'kicked');
        return;
      }
      case 'loaded':
        if (!m.loaded) {
          m.loaded = true;
          this.dirty = true;
          this.checkAllLoaded();
          if (s.phase === 'grid') this.broadcastRoom();
        }
        return;
      case 'rematch':
        if (s.host !== m.id) return this.error(c.id, 'not_host', 'only the host starts a rematch');
        this.toLobby();
        return;
      case 'lap':
        this.onLap(c, m, msg);
        return;
      case 'limits': {
        if (!this.owns(m, msg.seat)) return this.notOwner(c, msg.seat);
        const car = this.car(msg.seat) as CarRecord;
        car.warnings += 1;
        if (!car.invalidLaps.includes(msg.lap)) car.invalidLaps.push(msg.lap);
        deriveProgress(car);
        this.dirty = true;
        this.broadcast({ type: 'limits', seat: car.seat, lap: msg.lap, warnings: car.warnings });
        if (car.warnings > LIMITS.limitsFreeWarnings) {
          this.penalise(car, LIMITS.limitsPenaltyMs, 'track_limits');
        }
        return;
      }
      case 'jump_start': {
        if (!this.owns(m, msg.seat)) return this.notOwner(c, msg.seat);
        this.jumpStart(this.car(msg.seat) as CarRecord);
        return;
      }
      case 'pit':
        if (!this.owns(m, msg.seat)) return this.notOwner(c, msg.seat);
        this.broadcast({ type: 'pit', seat: msg.seat, event: msg.event, lap: msg.lap, at: msg.at });
        return;
      case 'retire': {
        if (!this.owns(m, msg.seat)) return this.notOwner(c, msg.seat);
        const car = this.car(msg.seat) as CarRecord;
        if (car.state === 'racing') {
          car.state = 'dnf';
          this.broadcastRoom();
          this.checkRaceEnd();
        }
        return;
      }
    }
  }

  private notOwner(c: ConnState, seat: number): void {
    if (this.strike(c)) this.error(c.id, 'not_owner', `you do not drive seat ${seat}`);
  }

  private penalise(car: CarRecord, ms: number, reason: 'jump_start' | 'track_limits'): void {
    car.penaltyMs += ms;
    this.dirty = true;
    this.broadcast({ type: 'penalty', seat: car.seat, ms, reason, totalMs: car.penaltyMs });
  }

  private jumpStart(car: CarRecord): void {
    if (car.jumpStart) return;
    car.jumpStart = true;
    this.penalise(car, LIMITS.jumpPenaltyMs, 'jump_start');
  }

  private onJoin(c: ConnState, msg: Extract<ClientMessage, { type: 'join' }>): void {
    const s = this.state;
    if (c.member !== null) {
      if (this.strike(c)) this.error(c.id, 'already_joined', 'this socket has already joined');
      return;
    }
    const refuse = (code: ErrorCode, detail: string, close: number) => {
      this.error(c.id, code, detail);
      this.closeConn(c.id, close, code);
    };
    if (msg.v !== PROTOCOL_VERSION) {
      return refuse('version_mismatch', `server speaks ${PROTOCOL_VERSION}`, CLOSE.versionMismatch);
    }
    if (s.phase === 'closed') return refuse('room_closed', 'the room has closed', CLOSE.roomClosed);
    const name = sanitizeName(msg.name);
    if (name === null)
      return refuse('name_invalid', 'that name cannot be shown', CLOSE.nameInvalid);

    if (msg.resume !== undefined) {
      const m = s.members.find((x) => x.token === msg.resume);
      if (m) return this.resume(c, m);
      const retired = s.retiredTokens.find((r) => r.token === msg.resume);
      if (retired?.why === 'kicked') return refuse('kicked', 'you were removed', CLOSE.kicked);
      if (retired) return refuse('resume_expired', 'the seat was given up', CLOSE.resumeExpired);
      return refuse('resume_invalid', 'unknown resume token', CLOSE.resumeInvalid);
    }
    if (s.phase !== 'lobby' && s.phase !== 'results') {
      return refuse('race_in_progress', 'a race is running; join after it', CLOSE.raceInProgress);
    }
    if (s.members.length >= MAX_HUMANS)
      return refuse('room_full', 'the room is full', CLOSE.roomFull);

    const taken = new Set(s.members.map((x) => x.seat));
    let seat = 0;
    while (taken.has(seat)) seat++;
    const m: Member = {
      id: `m${s.nextMember++}`,
      name,
      seat,
      token: this.deps.token(),
      ready: false,
      loaded: false,
      conn: c.id,
      joinedAt: this.now,
      connectedSince: this.now,
      graceUntil: null,
      status: 'active',
      lastSnapshotAt: null,
      outages: [],
    };
    s.members.push(m);
    c.member = m.id;
    s.closeAt = null;
    if (s.host === null) s.host = m.id;
    this.welcome(c, m);
    this.ensureHost();
    this.updateCountdown();
    this.broadcastRoom();
  }

  private resume(c: ConnState, m: Member): void {
    const s = this.state;
    if (m.conn !== null && m.conn !== c.id) {
      const old = this.conn(m.conn);
      if (old) {
        old.member = null;
        this.out.push({ kind: 'close', to: old.id, code: CLOSE.replaced, reason: 'replaced' });
        s.conns = s.conns.filter((x) => x !== old);
      }
    }
    m.conn = c.id;
    c.member = m.id;
    m.connectedSince = this.now;
    m.graceUntil = null;
    m.status = 'active';
    if (m.lastSnapshotAt !== null) m.lastSnapshotAt = this.now;
    const open = m.outages[m.outages.length - 1];
    if (open && open[1] === null) open[1] = this.now;
    s.closeAt = null;
    this.dirty = true;
    this.welcome(c, m);
    this.ensureHost();
    this.updateCountdown();
    this.broadcastRoom();
  }

  private welcome(c: ConnState, m: Member): void {
    const car = this.state.cars?.find((x) => x.member === m.id) ?? null;
    this.sendTo(c.id, {
      type: 'welcome',
      v: PROTOCOL_VERSION,
      you: m.id,
      resume: m.token,
      seat: m.seat,
      epoch: this.state.epoch,
      now: this.now,
      room: this.view(),
      car: car ? (this.seats.get(car.seat)?.snap ?? null) : null,
      progress: car ? { lap: car.lap, raceMs: car.raceMs } : null,
    });
    // A host who resumes mid-race needs the AI cars back.
    if (this.state.host === m.id && this.state.cars && ON_TRACK.has(this.state.phase)) {
      this.sendTo(c.id, { type: 'host', member: m.id, ai: this.aiHandover() });
    }
    // Coming back during the results: the classification is part of what they missed.
    if (this.state.phase === 'results' && this.state.results) {
      this.sendTo(c.id, { type: 'results', results: this.state.results });
    }
  }

  // ---- Timing ------------------------------------------------------------------

  private onLap(c: ConnState, m: Member, msg: LapMessage): void {
    const s = this.state;
    const car = this.car(msg.seat);
    const reply = (status: 'rejected', reason: 'not_owner') =>
      this.sendTo(c.id, timingMessage(msg, status, reason));
    if (!car || !this.owns(m, msg.seat)) {
      reply('rejected', 'not_owner');
      this.strike(c);
      return;
    }
    const owner = car.kind === 'human' ? this.member(car.member) : undefined;
    const track = this.seats.get(car.seat);
    const verdict = judgeLap(
      car,
      msg,
      s.settings.circuit,
      {
        snapshot: track?.snap ?? null,
        snapshotAt: track?.at ?? null,
        outages: owner?.outages ?? [],
        lightsOutAt: s.start?.lightsOutAt ?? 0,
      },
      this.now,
    );
    if (verdict.status === 'rejected') {
      this.sendTo(c.id, timingMessage(msg, 'rejected', verdict.reason));
      return;
    }
    car.crossings.push({
      lap: msg.lap,
      raceMs: msg.raceMs,
      lapMs: msg.lapMs,
      gap: msg.lap - car.lap,
      receivedAt: this.now,
      flag: verdict.status === 'flagged' ? verdict.reason : null,
    });
    deriveProgress(car);
    this.dirty = true;
    this.broadcast(timingMessage(msg, verdict.status, verdict.reason));
    if (this.resolveFlag()) this.broadcastRoom();
    this.checkRaceEnd();
  }

  // ---- Snapshots ---------------------------------------------------------------

  private onBinary(id: string, data: Uint8Array): void {
    if (this.state.phase === 'closed') return;
    const c = this.conn(id) ?? this.register(id, 'unknown');
    const m = this.member(c.member);
    if (!m) {
      if (this.strike(c)) this.error(id, 'not_joined', 'send join first');
      return;
    }
    if (!take(c.snapshot, LIMITS.snapshot, this.now)) {
      this.rateLimited(c, 'snapshot');
      return;
    }
    if (data.byteLength > MAX_UP_FRAME_BYTES) {
      if (this.strike(c)) this.error(id, 'too_large', 'snapshot frame too large');
      return;
    }
    const decoded = decodeUpFrame(data, this.state.epoch);
    if (!decoded.ok) {
      if (this.strike(c)) this.error(id, 'bad_message', decoded.detail);
      return;
    }
    if (!SNAPSHOT_PHASES.has(this.state.phase)) return;
    const accepted: CarSnapshot[] = [];
    let foreign = false;
    for (const snap of decoded.frame.cars) {
      if (!this.owns(m, snap.seat)) {
        foreign = true;
        continue;
      }
      const track = this.seats.get(snap.seat);
      if (track && snap.tick <= track.tick) continue; // stale or duplicate: drop
      this.seats.set(snap.seat, { tick: snap.tick, snap, at: this.now });
      accepted.push(snap);
      const start = this.state.start;
      if (start && this.now < start.lightsOutAt && snapshotSpeed(snap) > LIMITS.jumpSpeed) {
        this.jumpStart(this.car(snap.seat) as CarRecord);
      }
    }
    if (foreign)
      this.notOwner(c, decoded.frame.cars.find((x) => !this.owns(m, x.seat))?.seat ?? -1);
    if (accepted.length === 0) return;
    m.lastSnapshotAt = this.now;
    if (m.status !== 'active') {
      m.status = 'active';
      m.graceUntil = null;
      this.ensureHost();
      this.broadcastRoom();
    }
    const others = this.joinedConns(id);
    if (others.length > 0) {
      this.out.push({
        kind: 'binary',
        to: others,
        data: encodeDownFrame(accepted, this.now, this.state.epoch),
      });
    }
  }
}

function newCar(
  seat: number,
  kind: 'human' | 'ai',
  member: string | null,
  aiIndex: number | null,
  name: string | null,
): CarRecord {
  return {
    seat,
    kind,
    member,
    aiIndex,
    name,
    gridPosition: 0,
    state: 'racing',
    lap: 0,
    raceMs: 0,
    lastCrossAt: null,
    bestLapMs: null,
    crossings: [],
    penaltyMs: 0,
    warnings: 0,
    jumpStart: false,
    invalidLaps: [],
    flags: [],
  };
}

/** Laps, race time, best lap and flags from a car's counted crossings. */
function deriveProgress(car: CarRecord): void {
  const last = car.crossings[car.crossings.length - 1];
  car.lap = last?.lap ?? 0;
  car.raceMs = last?.raceMs ?? 0;
  car.lastCrossAt = last?.receivedAt ?? null;
  car.bestLapMs = null;
  car.flags = [];
  for (const x of car.crossings) {
    if (x.gap === 1 && !car.invalidLaps.includes(x.lap)) {
      car.bestLapMs = car.bestLapMs === null ? x.lapMs : Math.min(car.bestLapMs, x.lapMs);
    }
    if (x.flag !== null && !car.flags.includes(x.flag)) car.flags.push(x.flag);
  }
}

const gridSlot = (c: CarRecord): GridSlot => ({
  seat: c.seat,
  kind: c.kind,
  member: c.member,
  aiIndex: c.aiIndex,
  state: c.state,
});

function timingMessage(
  msg: LapMessage,
  status: 'accepted' | 'flagged' | 'rejected',
  reason: TimingReason | null,
): ServerMessage {
  return {
    type: 'timing',
    seat: msg.seat,
    lap: msg.lap,
    lapMs: msg.lapMs,
    raceMs: msg.raceMs,
    sectorsMs: msg.sectorsMs ?? [],
    status,
    reason,
  };
}
