/**
 * The game's one room connection. A thin layer over the protocol's `RoomClient`: it creates or
 * looks up the room over HTTP, joins (or takes a seat back with the token kept for this tab),
 * and turns the client's events into one plain state object for the screens, plus notices worth
 * a line on screen. All protocol behaviour (clock sync, reconnect, snapshot buffering) is the
 * library's; nothing here re-implements it.
 *
 * No DOM: the network, clock and storage come in as dependencies, so the tests run it against
 * the real room state machine in memory.
 */
import {
  CLOSE,
  RoomClient,
  normalizeRoomCode,
  roomsApi,
  sanitizeName,
  type Assists,
  type ConnectionStatus,
  type FetchLike,
  type MemberStatus,
  type Results,
  type RoomView,
  type Timers,
  type Transport,
} from '@undercut/protocol';
import { findOnlineCircuit } from './circuits';
import { seatLivery, type SeatLivery } from './liveries';
import { ending, endedBy, roomNotices, stageOf, type Ended, type Stage } from './view';

/** The subset of Web Storage used for seat tokens. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OnlineDeps {
  /** Base URL of the rooms service (the `/rooms` setting). */
  roomsUrl: string;
  fetch: FetchLike;
  transport: Transport;
  timers: Timers;
  random: () => number;
  /** Where seat tokens live for this tab (sessionStorage); null when storage is blocked. */
  storage: KeyValue | null;
}

export interface MemberRow {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  loaded: boolean;
  connected: boolean;
  status: MemberStatus;
  host: boolean;
  you: boolean;
  livery: SeatLivery;
}

export interface OnlineState {
  status: ConnectionStatus;
  /** Creating or looking up a room, before the socket opens. */
  busy: boolean;
  code: string | null;
  name: string;
  you: string | null;
  seat: number | null;
  isHost: boolean;
  room: RoomView | null;
  stage: Stage | null;
  members: MemberRow[];
  /** Every member but you is ready (the host may start). */
  allOthersReady: boolean;
  results: Results | null;
  ended: Ended | null;
}

export interface OnlineEvents {
  change: OnlineState;
  notice: string;
}

const TOKEN_KEY = (code: string): string => `online.resume.${code}`;

/** Wraps the transport so a disposed session can never open a socket again. */
class Gate {
  allowed = true;
  constructor(private readonly inner: Transport) {}
  get transport(): Transport {
    return {
      open: (url, handlers) => {
        if (this.allowed) return this.inner.open(url, handlers);
        void Promise.resolve().then(() => handlers.onClose(CLOSE.left, 'disposed'));
        return { sendText() {}, sendBinary() {}, bufferedAmount: 0, close() {} };
      },
    };
  }
}

type Listener<T> = (value: T) => void;

export class OnlineSession {
  private readonly api: ReturnType<typeof roomsApi>;
  private readonly listeners = new Map<keyof OnlineEvents, Set<Listener<never>>>();
  private clientValue: RoomClient | null = null;
  private gate: Gate | null = null;
  private unsubscribe: (() => void)[] = [];
  private results: Results | null = null;
  private ended: Ended | null = null;
  private busy = false;
  private generation = 0;
  private code: string | null = null;
  private name = '';
  private stateValue: OnlineState;

  constructor(private readonly deps: OnlineDeps) {
    this.api = roomsApi(deps.roomsUrl, deps.fetch);
    this.stateValue = this.build();
  }

  on<K extends keyof OnlineEvents>(event: K, fn: Listener<OnlineEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  private emit<K extends keyof OnlineEvents>(event: K, value: OnlineEvents[K]): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        (fn as Listener<OnlineEvents[K]>)(value);
      } catch (error) {
        void Promise.reject(error);
      }
    }
  }

  get state(): OnlineState {
    return this.stateValue;
  }

  /** The room client while connected (the race layer sends snapshots and laps through it). */
  get client(): RoomClient | null {
    return this.clientValue;
  }

  private changed(): void {
    this.stateValue = this.build();
    this.emit('change', this.stateValue);
  }

  private build(): OnlineState {
    const c = this.clientValue;
    const room = c?.room ?? null;
    const me = c?.me ?? null;
    const members: MemberRow[] = (room?.members ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      seat: m.seat,
      ready: m.ready,
      loaded: m.loaded,
      connected: m.connected,
      status: m.status,
      host: m.id === room?.host,
      you: m.id === me,
      livery: seatLivery(m.seat),
    }));
    return {
      status: c?.status ?? 'idle',
      busy: this.busy,
      code: this.code,
      name: this.name,
      you: me,
      seat: c?.seat ?? null,
      isHost: c?.isHost ?? false,
      room,
      stage: room ? stageOf(room) : null,
      members,
      allOthersReady: members.every((m) => m.you || m.ready),
      results: this.results,
      ended: this.ended,
    };
  }

  private fail(e: Ended): void {
    this.busy = false;
    this.ended = e;
    this.changed();
  }

  /** Create a room and join it as its host. */
  async create(rawName: string): Promise<void> {
    const name = sanitizeName(rawName);
    if (name === null) return this.fail(ending('name'));
    this.reset();
    const generation = this.generation;
    this.busy = true;
    this.name = name;
    this.changed();
    let res: { code: string } | { error: string };
    try {
      res = await this.api.create();
    } catch {
      if (generation !== this.generation) return;
      return this.fail(ending('lost'));
    }
    if (generation !== this.generation) return;
    if ('error' in res) {
      return this.fail({
        ...ending('lost'),
        title: 'Could not create a room',
        detail:
          res.error === 'http_429' || /limit|many/i.test(res.error)
            ? 'Too many rooms were made from this network lately. Wait a few minutes.'
            : 'The room service did not answer. Check your connection and try again.',
      });
    }
    this.connect(res.code, name);
  }

  /** Join a room by code (or take back this tab's seat in it). */
  async join(rawCode: string, rawName: string): Promise<void> {
    const name = sanitizeName(rawName);
    if (name === null) return this.fail(ending('name'));
    const code = normalizeRoomCode(rawCode);
    if (code === null) return this.fail(ending('not_found'));
    this.reset();
    const generation = this.generation;
    this.busy = true;
    this.name = name;
    this.code = code;
    this.changed();
    let info: Awaited<ReturnType<typeof this.api.info>>;
    try {
      info = await this.api.info(code);
    } catch {
      if (generation !== this.generation) return;
      return this.fail(ending('lost'));
    }
    if (generation !== this.generation) return;
    if (info === null) return this.fail(ending('not_found'));
    const token = this.token(code);
    if (!info.joinable && token === null) {
      const full = (info as { maxHumans?: number }).maxHumans ?? 8;
      return this.fail(ending(info.humans >= full ? 'full' : 'in_progress'));
    }
    this.connect(code, name);
  }

  private token(code: string): string | null {
    try {
      return this.deps.storage?.getItem(TOKEN_KEY(code)) ?? null;
    } catch {
      return null;
    }
  }

  private setToken(code: string, token: string | null): void {
    try {
      if (token === null) this.deps.storage?.removeItem(TOKEN_KEY(code));
      else this.deps.storage?.setItem(TOKEN_KEY(code), token);
    } catch {
      // Storage blocked: the seat just cannot be taken back after a reload.
    }
  }

  private connect(code: string, name: string, resume = this.token(code)): void {
    this.code = code;
    const gate = new Gate(this.deps.transport);
    this.gate = gate;
    const client = new RoomClient({
      url: this.api.socketUrl(code),
      name,
      transport: gate.transport,
      timers: this.deps.timers,
      random: this.deps.random,
      resume,
    });
    this.clientValue = client;
    let welcomed = false;
    let previous: RoomView | null = null;
    this.unsubscribe.push(
      client.on('status', () => this.changed()),
      client.on('welcome', (w) => {
        welcomed = true;
        this.busy = false;
        this.ended = null;
        this.setToken(code, w.resume);
        this.offAi();
        this.changed();
      }),
      client.on('room', (room) => {
        for (const n of roomNotices(previous, room, client.me)) this.emit('notice', n);
        previous = room;
        if (room.phase === 'lobby') this.results = null;
        this.offAi();
        this.changed();
      }),
      client.on('results', (m) => {
        this.results = m.results;
        this.changed();
      }),
      client.on('closed', (e) => {
        // A stale token (seat expired or unknown): join afresh once.
        if (
          !welcomed &&
          resume !== null &&
          (e.code === CLOSE.resumeExpired || e.code === CLOSE.resumeInvalid)
        ) {
          this.setToken(code, null);
          this.detach();
          this.connect(code, name, null);
          return;
        }
        if (
          e.code !== CLOSE.replaced &&
          (e.code === CLOSE.left ||
            e.code === CLOSE.normal ||
            e.code === CLOSE.kicked ||
            e.code === CLOSE.resumeExpired ||
            e.code === CLOSE.resumeInvalid ||
            e.code === CLOSE.roomClosed)
        ) {
          this.setToken(code, null);
        }
        this.busy = false;
        this.ended = endedBy(e);
        this.changed();
      }),
    );
    client.connect();
    this.changed();
  }

  /**
   * AI fill comes in a later slice (the host's game does not drive AI cars yet), so a room this
   * game hosts keeps it off; otherwise AI seats would sit on the grid and never finish.
   */
  private offAi(): void {
    const c = this.clientValue;
    const room = c?.room;
    if (!c || !room || !c.isHost || room.phase !== 'lobby') return;
    if (room.settings.aiCount !== 0) c.changeSettings({ aiCount: 0 });
  }

  setReady(ready: boolean): boolean {
    return this.clientValue?.setReady(ready) ?? false;
  }

  /** Host only, in the lobby. */
  setLaps(laps: number): boolean {
    const c = this.clientValue;
    if (!c?.isHost || !Number.isInteger(laps)) return false;
    return c.changeSettings({ laps: Math.max(1, Math.min(99, laps)) });
  }

  /** Host only, in the lobby: choose which circuit the room races. */
  setCircuit(id: string): boolean {
    const c = this.clientValue;
    const room = c?.room;
    if (!c?.isHost || room?.phase !== 'lobby') return false;
    const circuit = findOnlineCircuit(id);
    if (!circuit) return false;
    return c.changeSettings({ circuit: circuit.info });
  }

  /** Host only, in the lobby: which assists players may use. */
  setAssists(patch: Partial<Assists>): boolean {
    const c = this.clientValue;
    const room = c?.room;
    if (!c?.isHost || !room) return false;
    return c.changeSettings({ assists: { ...room.settings.assists, ...patch } });
  }

  /** Host only: settings updates through the room client. */
  changeSettings(patch: Parameters<RoomClient['changeSettings']>[0]): boolean {
    const c = this.clientValue;
    if (!c?.isHost) return false;
    return c.changeSettings(patch);
  }

  kick(member: string): boolean {
    const c = this.clientValue;
    if (!c?.isHost) return false;
    return c.kick(member);
  }

  rematch(): boolean {
    const c = this.clientValue;
    if (!c?.isHost) return false;
    return c.rematch();
  }

  /** Give the seat up for good. */
  leave(): void {
    const c = this.clientValue;
    if (!c) return;
    if (this.code) this.setToken(this.code, null);
    c.leave();
  }

  /** Forget an ended room so the entry screen starts clean. */
  clearEnded(): void {
    this.ended = null;
    this.changed();
  }

  private detach(): void {
    for (const u of this.unsubscribe.splice(0)) u();
    if (this.gate) this.gate.allowed = false;
    this.gate = null;
  }

  private reset(): void {
    this.generation++;
    const c = this.clientValue;
    this.detach();
    if (c && c.status !== 'closed') c.dropConnection();
    this.clientValue = null;
    this.results = null;
    this.ended = null;
    this.code = null;
  }

  /** Drop the connection without leaving (like closing the tab): the seat can be taken back. */
  dispose(): void {
    this.reset();
    this.busy = false;
    this.changed();
  }
}
