/**
 * An in-memory rooms service for the online layer's tests: the real room state machine behind a
 * transport with a fixed latency, deterministic timers, and the HTTP side (create, info) as a fake
 * fetch. A cut-down copy of the protocol package's own loopback.
 */
import {
  DEFAULT_SETTINGS,
  DEFAULT_TIMINGS,
  RoomMachine,
  type Connection,
  type FetchLike,
  type RoomSettings,
  type RoomTimings,
  type Timers,
  type Transport,
  type TransportHandlers,
} from '@undercut/protocol';

export class FakeTimers implements Timers {
  private t = 1000;
  private seq = 0;
  private queue: { at: number; seq: number; fn: () => void }[] = [];

  now = (): number => this.t;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const entry = { at: this.t + Math.max(0, ms), seq: this.seq++, fn };
    this.queue.push(entry);
    return entry;
  };

  clearTimeout = (handle: unknown): void => {
    this.queue = this.queue.filter((e) => e !== handle);
  };

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.queue[0];
      if (!next || next.at > end) break;
      this.queue.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

/** Short circuit, quick timers: a race fits in seconds of fake time. */
export const TEST_SETTINGS: Partial<RoomSettings> = {
  circuit: { id: 'test', lengthM: 600, minLapMs: 5000, minSectorMs: [], maxLapMs: 30_000 },
  laps: 2,
  aiCount: 2,
  gridOrder: 'join',
};

export class Rooms implements Transport {
  readonly machines = new Map<string, RoomMachine>();
  private readonly handlers = new Map<string, { code: string; h: TransportHandlers }>();
  private next = 0;
  private codes = ['BCDFGH', 'JKMNPQ', 'RSTVWX'];
  readonly fetch: FetchLike;

  constructor(
    readonly timers: FakeTimers,
    readonly latency = 20,
    readonly serverAhead = 5_000_000,
    readonly timings: Partial<RoomTimings> = {},
  ) {
    this.fetch = async (url, init) => {
      const path = new URL(url).pathname.replace(/^\/rooms\/?/, '');
      if (init?.method === 'POST' && path === '') {
        const code = this.codes.shift();
        if (!code) return { status: 429, json: async () => ({ error: 'too many rooms' }) };
        this.createRoom(code);
        return { status: 201, json: async () => ({ code, maxHumans: 8, protocol: 2 }) };
      }
      const m = this.machines.get(path);
      if (!m) return { status: 404, json: async () => ({ error: 'no such room' }) };
      const humans = m.state.members.length;
      return {
        status: 200,
        json: async () => ({
          code: path,
          phase: m.state.phase,
          humans,
          maxHumans: 8,
          joinable: (m.state.phase === 'lobby' || m.state.phase === 'results') && humans < 8,
        }),
      };
    };
  }

  serverNow(): number {
    return this.timers.now() + this.serverAhead;
  }

  createRoom(code: string): RoomMachine {
    let tok = 0;
    const m = RoomMachine.create(
      code,
      this.serverNow(),
      {
        randomInt: () => 0,
        token: () => (++tok).toString(16).padStart(32, '0'),
      },
      { ...DEFAULT_TIMINGS, ...this.timings },
      { ...DEFAULT_SETTINGS, ...TEST_SETTINGS },
    );
    this.machines.set(code, m);
    return m;
  }

  private deliver(_code: string, out: ReturnType<RoomMachine['handle']>): void {
    for (const o of out) {
      const targets = o.kind === 'binary' ? o.to : [o.to];
      for (const to of targets) {
        this.timers.setTimeout(() => {
          const entry = this.handlers.get(to);
          if (!entry) return;
          if (o.kind === 'text') entry.h.onText(o.text);
          else if (o.kind === 'binary') entry.h.onBinary(o.data);
          else {
            this.handlers.delete(to);
            entry.h.onClose(o.code, o.reason);
          }
        }, this.latency);
      }
    }
  }

  /** Run every room's timers (the service's alarm). */
  tick(): void {
    for (const [code, m] of this.machines)
      this.deliver(code, m.handle({ type: 'tick' }, this.serverNow()));
  }

  /** Advance time in small steps, ticking the rooms, as the real service would. */
  run(ms: number, step = 50): void {
    for (let t = 0; t < ms; t += step) {
      this.timers.advance(step);
      this.tick();
    }
  }

  /** Drop a connection as a network failure would. */
  cut(conn: string): void {
    const entry = this.handlers.get(conn);
    if (!entry) return;
    this.handlers.delete(conn);
    const m = this.machines.get(entry.code);
    if (m) this.deliver(entry.code, m.handle({ type: 'close', conn }, this.serverNow()));
    entry.h.onClose(1006, '');
  }

  conns(): string[] {
    return [...this.handlers.keys()];
  }

  open(url: string, handlers: TransportHandlers): Connection {
    const code = /\/rooms\/([A-Z0-9]+)\/ws$/.exec(url)?.[1] ?? '';
    const id = `k${++this.next}`;
    this.handlers.set(id, { code, h: handlers });
    const machine = () => this.machines.get(code);
    this.timers.setTimeout(() => {
      const m = machine();
      if (!m) {
        this.handlers.delete(id);
        handlers.onClose(1006, 'no such room');
        return;
      }
      this.deliver(
        code,
        m.handle({ type: 'open', conn: id, address: 'loopback' }, this.serverNow()),
      );
      handlers.onOpen();
    }, this.latency);
    const send = (event: { type: 'text'; data: string } | { type: 'binary'; data: Uint8Array }) =>
      this.timers.setTimeout(() => {
        const m = machine();
        if (!this.handlers.has(id) || !m) return;
        this.deliver(
          code,
          m.handle(
            event.type === 'text'
              ? { type: 'text', conn: id, data: event.data }
              : { type: 'binary', conn: id, data: event.data },
            this.serverNow(),
          ),
        );
      }, this.latency);
    return {
      sendText: (data) => send({ type: 'text', data }),
      sendBinary: (data) => send({ type: 'binary', data }),
      bufferedAmount: 0,
      close: () => {
        if (!this.handlers.has(id)) return;
        this.timers.setTimeout(() => {
          this.handlers.delete(id);
          const m = machine();
          if (m) this.deliver(code, m.handle({ type: 'close', conn: id }, this.serverNow()));
          handlers.onClose(1000, '');
        }, this.latency);
      },
    };
  }
}

/** A Map-backed stand-in for sessionStorage. */
export function memoryKv(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
