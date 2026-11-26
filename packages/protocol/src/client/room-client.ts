/**
 * The game's side of a room: join or resume a seat, keep the server clock, send our
 * cars at about 30 Hz, buffer everyone else's for interpolation, report timing events,
 * and reconnect with backoff to the same seat after a drop. Pure: transport, clock,
 * timers and randomness are injected, so it runs in Node tests and in the browser.
 */
import { TERMINAL_CLOSE_CODES } from '../errors';
import {
  PROTOCOL_VERSION,
  encodeClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ErrorMessage,
  type HostMessage,
  type LapMessage,
  type LimitsWarningMessage,
  type OrderMessage,
  type PenaltyMessage,
  type PitEvent,
  type PitRelayMessage,
  type ResultsMessage,
  type RoomView,
  type ServerMessage,
  type StartSchedule,
  type TimingMessage,
  type WelcomeMessage,
} from '../messages';
import type { SettingsPatch } from '../settings';
import { decodeDownFrame, encodeUpFrame, type CarSnapshot, type DownFrame } from '../snapshot';
import { Backoff, DEFAULT_BACKOFF, type BackoffOptions } from './backoff';
import { ClockSync } from './clock';
import { RemoteCarBuffer, type RemoteCarOptions } from './remote-cars';
import { SnapshotScheduler } from './scheduler';
import type { Connection, Transport } from './transport';

/** Local time and timers. In a browser: performance.now and window.setTimeout. */
export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'joined' | 'reconnecting' | 'closed';

export interface ClosedEvent {
  code: number;
  reason: string;
  /** The last error the server sent before closing, if any. */
  error: ErrorMessage | null;
}

export interface RoomClientEvents {
  status: ConnectionStatus;
  welcome: WelcomeMessage;
  room: RoomView;
  start: StartSchedule;
  timing: TimingMessage;
  penalty: PenaltyMessage;
  limits: LimitsWarningMessage;
  pit: PitRelayMessage;
  host: HostMessage;
  order: OrderMessage;
  results: ResultsMessage;
  error: ErrorMessage;
  snapshots: DownFrame;
  closed: ClosedEvent;
}

export interface RoomClientOptions {
  /** WebSocket URL of the room (see `roomSocketUrl`). */
  url: string;
  name: string;
  transport: Transport;
  timers: Timers;
  /** Uniform [0, 1), for backoff jitter. */
  random: () => number;
  /** Resume token from an earlier session (to take the same seat back). */
  resume?: string | null;
  pingIntervalMs?: number;
  backoff?: Partial<BackoffOptions>;
  snapshotRateHz?: number;
  maxBufferedBytes?: number;
  remote?: Partial<RemoteCarOptions>;
}

/** Reports kept while reconnecting and sent after the seat is back. */
const QUEUED: ReadonlySet<ClientMessage['type']> = new Set([
  'lap',
  'limits',
  'pit',
  'retire',
  'jump_start',
]);
const MAX_QUEUED = 64;
/** Fast pings until the clock estimate has this many samples. */
const WARM_SAMPLES = 6;
const WARM_INTERVAL_MS = 150;

type Listener<T> = (value: T) => void;

export class RoomClient {
  readonly clock = new ClockSync();
  readonly remoteCars: RemoteCarBuffer;
  private readonly scheduler: SnapshotScheduler;
  private readonly backoff: Backoff;
  private readonly listeners = new Map<keyof RoomClientEvents, Set<Listener<never>>>();
  private conn: Connection | null = null;
  private statusValue: ConnectionStatus = 'idle';
  private token: string | null;
  private welcomeMsg: WelcomeMessage | null = null;
  private roomView: RoomView | null = null;
  private lastError: ErrorMessage | null = null;
  private pingTimer: unknown = null;
  private retryTimer: unknown = null;
  private pingId = 0;
  private readonly pingsSent = new Map<number, number>();
  private queue: string[] = [];
  private readonly orders: OrderMessage[] = [];
  private leaving = false;

  constructor(private readonly options: RoomClientOptions) {
    this.token = options.resume ?? null;
    this.remoteCars = new RemoteCarBuffer(options.remote);
    this.scheduler = new SnapshotScheduler(options.snapshotRateHz ?? 30, options.maxBufferedBytes);
    this.backoff = new Backoff({ ...DEFAULT_BACKOFF, ...options.backoff }, options.random);
  }

  // ---- Events ------------------------------------------------------------------

  on<K extends keyof RoomClientEvents>(event: K, fn: Listener<RoomClientEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  private emit<K extends keyof RoomClientEvents>(event: K, value: RoomClientEvents[K]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        (fn as Listener<RoomClientEvents[K]>)(value);
      } catch (error) {
        // One broken listener must not stop the others or the client: report it as an
        // unhandled rejection, which the page or test runner surfaces.
        void Promise.reject(error);
      }
    }
  }

  // ---- State -------------------------------------------------------------------

  get status(): ConnectionStatus {
    return this.statusValue;
  }

  /** Our member id, once welcomed. */
  get me(): string | null {
    return this.welcomeMsg?.you ?? null;
  }

  get seat(): number | null {
    return this.welcomeMsg?.seat ?? null;
  }

  /** Keep this (for example in session storage) to resume after a reload. */
  get resumeToken(): string | null {
    return this.token;
  }

  get epoch(): number | null {
    return this.welcomeMsg?.epoch ?? null;
  }

  get room(): RoomView | null {
    return this.roomView;
  }

  get isHost(): boolean {
    return this.me !== null && this.roomView?.host === this.me;
  }

  /** Seats whose snapshots this client sends: its own car, plus the AI when host. */
  ownedSeats(): number[] {
    const room = this.roomView;
    const me = this.me;
    if (!room || me === null) return [];
    if (!room.grid) return this.seat === null ? [] : [this.seat];
    return room.grid
      .filter((g) => (g.kind === 'human' ? g.member === me : room.host === me))
      .map((g) => g.seat);
  }

  /** Estimated server time now, or null before the first pong. */
  serverNow(): number | null {
    return this.clock.serverTime(this.options.timers.now());
  }

  /** Local time at which a server time occurs (for the start lights). */
  localTimeOf(serverTime: number): number | null {
    return this.clock.localTime(serverTime);
  }

  /** Latest service-published running order whose activation time has been reached. */
  orderAt(serverNow: number): OrderMessage | null {
    for (let i = this.orders.length - 1; i >= 0; i--) {
      if (this.orders[i]!.at <= serverNow) return this.orders[i]!;
    }
    return null;
  }

  // ---- Connection --------------------------------------------------------------

  connect(): void {
    if (this.statusValue !== 'idle' && this.statusValue !== 'closed') return;
    this.leaving = false;
    this.lastError = null;
    this.backoff.reset();
    this.open('connecting');
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.emit('status', status);
  }

  private open(status: 'connecting' | 'reconnecting'): void {
    this.setStatus(status);
    const conn = this.options.transport.open(this.options.url, {
      onOpen: () => {
        if (this.conn !== conn) return;
        const join: ClientMessage = {
          type: 'join',
          v: PROTOCOL_VERSION,
          name: this.options.name,
          ...(this.token ? { resume: this.token } : {}),
        };
        conn.sendText(encodeClientMessage(join));
      },
      onText: (text) => {
        if (this.conn === conn) this.onText(text);
      },
      onBinary: (data) => {
        if (this.conn === conn) this.onBinary(data);
      },
      onClose: (code, reason) => {
        if (this.conn === conn) this.onClose(code, reason);
      },
    });
    this.conn = conn;
  }

  private onClose(code: number, reason: string): void {
    this.conn = null;
    this.stopPings();
    const terminal =
      this.leaving ||
      TERMINAL_CLOSE_CODES.has(code) ||
      (this.statusValue === 'connecting' && this.welcomeMsg === null && code !== 1006) ||
      this.backoff.exhausted;
    if (terminal) {
      this.finish(code, reason);
      return;
    }
    this.setStatus('reconnecting');
    const delay = this.backoff.next();
    this.retryTimer = this.options.timers.setTimeout(() => {
      this.retryTimer = null;
      if (this.statusValue === 'reconnecting') this.open('reconnecting');
    }, delay);
  }

  private finish(code: number, reason: string): void {
    if (this.retryTimer !== null) this.options.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPings();
    this.setStatus('closed');
    this.emit('closed', { code, reason, error: this.lastError });
  }

  /** Leave the room for good (the seat is given up). */
  leave(): void {
    this.leaving = true;
    if (this.conn) {
      this.send({ type: 'leave' });
      this.conn.close(1000, 'leaving');
    } else {
      this.finish(1000, 'left');
    }
  }

  /** Drop the connection without leaving (tests, and tab-close simulations). */
  dropConnection(): void {
    this.conn?.close(4999, 'dropped');
  }

  // ---- Incoming ------------------------------------------------------------------

  private onText(text: string): void {
    const msg = parseServerMessage(text);
    if (!msg) return;
    this.onMessage(msg);
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.orders.length = 0;
        this.welcomeMsg = msg;
        this.token = msg.resume;
        this.backoff.reset();
        this.setRoom(msg.room);
        this.setStatus('joined');
        this.emit('welcome', msg);
        this.flushQueue();
        this.startPings();
        return;
      case 'room':
        this.setRoom(msg.room);
        return;
      case 'pong': {
        const sent = this.pingsSent.get(msg.id);
        if (sent === undefined) return;
        this.pingsSent.delete(msg.id);
        this.clock.add(sent, msg.now, this.options.timers.now());
        return;
      }
      case 'start':
        this.emit('start', {
          lightsStartAt: msg.lightsStartAt,
          lightIntervalMs: msg.lightIntervalMs,
          lightCount: msg.lightCount,
          lightsOutAt: msg.lightsOutAt,
        });
        return;
      case 'host':
        if (this.roomView) this.roomView = { ...this.roomView, host: msg.member };
        if (msg.member === this.me) for (const a of msg.ai) this.remoteCars.remove(a.seat);
        this.emit('host', msg);
        return;
      case 'order': {
        let i = this.orders.length;
        while (i > 0 && this.orders[i - 1]!.at > msg.at) i--;
        this.orders.splice(i, 0, msg);
        if (this.orders.length > 32) this.orders.shift();
        this.emit('order', msg);
        return;
      }
      case 'error':
        this.lastError = msg;
        this.emit('error', msg);
        return;
      case 'timing':
        this.emit('timing', msg);
        return;
      case 'penalty':
        this.emit('penalty', msg);
        return;
      case 'limits':
        this.emit('limits', msg);
        return;
      case 'pit':
        this.emit('pit', msg);
        return;
      case 'results':
        this.emit('results', msg);
        return;
    }
  }

  private setRoom(room: RoomView): void {
    const phaseChanged = this.roomView?.phase !== room.phase;
    this.roomView = room;
    if (phaseChanged && (room.phase === 'lobby' || room.phase === 'grid')) {
      this.remoteCars.clear();
      this.scheduler.reset();
      this.orders.length = 0;
    }
    this.emit('room', room);
  }

  private onBinary(data: Uint8Array): void {
    const epoch = this.epoch;
    if (epoch === null) return;
    const decoded = decodeDownFrame(data, epoch);
    if (!decoded.ok) return;
    const arrived = this.serverNow() ?? decoded.frame.receivedAt;
    const mine = new Set(this.ownedSeats());
    for (const car of decoded.frame.cars) {
      if (!mine.has(car.seat)) this.remoteCars.push(car, arrived);
    }
    this.emit('snapshots', decoded.frame);
  }

  // ---- Clock -------------------------------------------------------------------

  private startPings(): void {
    this.stopPings();
    const tick = () => {
      this.ping();
      const warm = this.clock.sampleCount < WARM_SAMPLES;
      this.pingTimer = this.options.timers.setTimeout(
        tick,
        warm ? WARM_INTERVAL_MS : (this.options.pingIntervalMs ?? 2000),
      );
    };
    tick();
  }

  private stopPings(): void {
    if (this.pingTimer !== null) this.options.timers.clearTimeout(this.pingTimer);
    this.pingTimer = null;
    this.pingsSent.clear();
  }

  private ping(): void {
    const id = ++this.pingId;
    const t = this.options.timers.now();
    this.pingsSent.set(id, t);
    if (this.pingsSent.size > 16) {
      const oldest = this.pingsSent.keys().next().value;
      if (oldest !== undefined) this.pingsSent.delete(oldest);
    }
    this.send({ type: 'ping', id, t });
  }

  // ---- Outgoing ----------------------------------------------------------------

  private send(message: ClientMessage): boolean {
    const text = encodeClientMessage(message);
    if (this.conn && this.statusValue === 'joined') {
      this.conn.sendText(text);
      return true;
    }
    if (QUEUED.has(message.type)) {
      this.queue.push(text);
      if (this.queue.length > MAX_QUEUED) this.queue.shift();
    } else if (message.type === 'leave' && this.conn) {
      this.conn.sendText(text);
      return true;
    }
    return false;
  }

  private flushQueue(): void {
    const queued = this.queue;
    this.queue = [];
    for (const text of queued) this.conn?.sendText(text);
  }

  setReady(ready: boolean): boolean {
    return this.send({ type: 'ready', ready });
  }

  changeSettings(patch: SettingsPatch): boolean {
    return this.send({ type: 'settings', patch });
  }

  kick(member: string): boolean {
    return this.send({ type: 'kick', member });
  }

  markLoaded(): boolean {
    return this.send({ type: 'loaded' });
  }

  rematch(): boolean {
    return this.send({ type: 'rematch' });
  }

  /** A line crossing. Queued while reconnecting. */
  reportLap(lap: Omit<LapMessage, 'type'>): boolean {
    return this.send({ type: 'lap', ...lap });
  }

  reportLimits(seat: number, lap: number): boolean {
    return this.send({ type: 'limits', seat, lap });
  }

  reportJumpStart(seat: number): boolean {
    return this.send({ type: 'jump_start', seat });
  }

  reportPit(seat: number, event: PitEvent, lap: number, at: number): boolean {
    return this.send({ type: 'pit', seat, event, lap, at });
  }

  retire(seat: number): boolean {
    return this.send({ type: 'retire', seat });
  }

  /** Is a snapshot send due now? Lets the game skip building snapshots between slots. */
  snapshotDue(): boolean {
    return this.statusValue === 'joined' && this.scheduler.due(this.options.timers.now());
  }

  /**
   * Offer our cars' current state. Sent if a 30 Hz slot is due and the socket is not
   * backed up; otherwise dropped (never queued). Returns whether it was sent.
   */
  sendSnapshots(cars: readonly CarSnapshot[]): boolean {
    const conn = this.conn;
    const epoch = this.epoch;
    if (!conn || epoch === null || this.statusValue !== 'joined' || cars.length === 0) return false;
    if (!this.scheduler.take(this.options.timers.now(), conn.bufferedAmount)) return false;
    conn.sendBinary(encodeUpFrame(cars, epoch));
    return true;
  }

  /** Snapshot sends and skips so far (backpressure shows up as skips). */
  get snapshotStats(): { sent: number; skipped: number; queuedReports: number } {
    return {
      sent: this.scheduler.sent,
      skipped: this.scheduler.skipped,
      queuedReports: this.queue.length,
    };
  }
}

/**
 * Turn the rooms base URL (the game's setting, e.g. `https://host/rooms`) into the
 * room's WebSocket URL.
 */
export function roomSocketUrl(roomsUrl: string, code: string): string {
  const base = roomsUrl.replace(/\/+$/, '').replace(/^http(s?):/, 'ws$1:');
  return `${base}/${encodeURIComponent(code)}/ws`;
}

/** Minimal fetch, so this package needs no DOM types. */
export type FetchLike = (
  url: string,
  init?: { method?: string },
) => Promise<{ status: number; json(): Promise<unknown> }>;

/** HTTP side of the rooms service: create a room, look one up for an invite link. */
export function roomsApi(roomsUrl: string, fetchFn: FetchLike) {
  const base = roomsUrl.replace(/\/+$/, '');
  return {
    async create(): Promise<{ code: string } | { error: string }> {
      const res = await fetchFn(base, { method: 'POST' });
      const body = (await res.json()) as { code?: unknown; error?: unknown };
      if (res.status === 201 && typeof body.code === 'string') return { code: body.code };
      return { error: typeof body.error === 'string' ? body.error : `http_${res.status}` };
    },
    async info(code: string): Promise<{ phase: string; humans: number; joinable: boolean } | null> {
      const res = await fetchFn(`${base}/${encodeURIComponent(code)}`);
      if (res.status !== 200) return null;
      return (await res.json()) as { phase: string; humans: number; joinable: boolean };
    },
    socketUrl: (code: string) => roomSocketUrl(base, code),
  };
}
