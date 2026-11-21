/** Drives a RoomMachine in tests: fake clock, seeded randomness, decoded outbound. */
import { createRng } from '@undercut/core';
import {
  CLOSE,
  DEFAULT_SETTINGS,
  DEFAULT_TIMINGS,
  PROTOCOL_VERSION,
  RoomMachine,
  decodeDownFrame,
  encodeUpFrame,
  type CarSnapshot,
  type ClientMessage,
  type Outbound,
  type RoomSettings,
  type RoomTimings,
  type ServerMessage,
  type WelcomeMessage,
} from '../src/index';

export const CODE = 'BCDFGH';
export const T0 = 1_700_000_000_000;

/** A short circuit so races are quick: 600 m, laps no faster than 5 s. */
export const TEST_SETTINGS: Partial<RoomSettings> = {
  circuit: {
    id: 'test',
    lengthM: 600,
    minLapMs: 5000,
    minSectorMs: [1500, 1500, 1500],
    maxLapMs: 30_000,
  },
  laps: 3,
  aiCount: 2,
  gridOrder: 'join',
};

export interface Inbox {
  messages: ServerMessage[];
  frames: Uint8Array[];
  closed: { code: number; reason: string } | null;
}

export function car(seat: number, over: Partial<CarSnapshot> = {}): CarSnapshot {
  return {
    seat,
    flags: 0,
    resets: 0,
    tick: 1,
    t: T0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yawRate: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    gear: 1,
    rpm: 4000,
    wheelSpin: [0, 0, 0, 0],
    lap: 0,
    s: 0,
    ...over,
  };
}

export class Harness {
  readonly machine: RoomMachine;
  now = T0;
  readonly inbox = new Map<string, Inbox>();
  private tokenNo = 0;

  constructor(timings: Partial<RoomTimings> = {}, settings: Partial<RoomSettings> = TEST_SETTINGS) {
    const rng = createRng(7);
    this.machine = RoomMachine.create(
      CODE,
      this.now,
      {
        randomInt: (n) => rng.int(0, n - 1),
        token: () => (++this.tokenNo).toString(16).padStart(32, '0'),
      },
      { ...DEFAULT_TIMINGS, ...timings },
      { ...DEFAULT_SETTINGS, ...settings },
    );
  }

  get state() {
    return this.machine.state;
  }

  box(conn: string): Inbox {
    let b = this.inbox.get(conn);
    if (!b) {
      b = { messages: [], frames: [], closed: null };
      this.inbox.set(conn, b);
    }
    return b;
  }

  private apply(out: Outbound[]): Outbound[] {
    for (const o of out) {
      if (o.kind === 'text') this.box(o.to).messages.push(JSON.parse(o.text) as ServerMessage);
      else if (o.kind === 'binary') for (const to of o.to) this.box(to).frames.push(o.data);
      else this.box(o.to).closed = { code: o.code, reason: o.reason };
    }
    return out;
  }

  at(ms: number): this {
    this.now = ms;
    return this;
  }

  /** Advance the clock and deliver a tick. */
  advance(ms: number): Outbound[] {
    this.now += ms;
    return this.apply(this.machine.handle({ type: 'tick' }, this.now));
  }

  /** Run ticks at the machine's requested wake times until `until` passes. */
  runUntil(until: number): void {
    for (let i = 0; i < 10_000; i++) {
      const wake = this.machine.nextWakeAt();
      if (wake === null || wake > until) break;
      this.now = Math.max(this.now, wake);
      this.apply(this.machine.handle({ type: 'tick' }, this.now));
    }
    this.now = Math.max(this.now, until);
    this.apply(this.machine.handle({ type: 'tick' }, this.now));
  }

  open(conn: string, address = 'test'): Outbound[] {
    this.box(conn);
    return this.apply(this.machine.handle({ type: 'open', conn, address }, this.now));
  }

  raw(conn: string, data: string): Outbound[] {
    return this.apply(this.machine.handle({ type: 'text', conn, data }, this.now));
  }

  send(conn: string, message: ClientMessage | Record<string, unknown>): Outbound[] {
    return this.raw(conn, JSON.stringify(message));
  }

  binary(conn: string, data: Uint8Array): Outbound[] {
    return this.apply(this.machine.handle({ type: 'binary', conn, data }, this.now));
  }

  snap(conn: string, cars: CarSnapshot[]): Outbound[] {
    return this.binary(conn, encodeUpFrame(cars, this.state.epoch));
  }

  close(conn: string): Outbound[] {
    return this.apply(this.machine.handle({ type: 'close', conn }, this.now));
  }

  /** Open a socket and join; returns the welcome. */
  join(conn: string, name: string, resume?: string): WelcomeMessage {
    this.open(conn);
    this.send(conn, { type: 'join', v: PROTOCOL_VERSION, name, ...(resume ? { resume } : {}) });
    const w = this.box(conn).messages.find((m) => m.type === 'welcome');
    if (!w || w.type !== 'welcome') throw new Error(`no welcome for ${conn}`);
    return w;
  }

  last<T extends ServerMessage['type']>(
    conn: string,
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    const list = this.box(conn).messages.filter((m) => m.type === type);
    return list[list.length - 1] as Extract<ServerMessage, { type: T }> | undefined;
  }

  all<T extends ServerMessage['type']>(
    conn: string,
    type: T,
  ): Extract<ServerMessage, { type: T }>[] {
    return this.box(conn).messages.filter((m) => m.type === type) as Extract<
      ServerMessage,
      { type: T }
    >[];
  }

  clear(): void {
    for (const b of this.inbox.values()) {
      b.messages = [];
      b.frames = [];
    }
  }

  relayed(conn: string): CarSnapshot[] {
    return this.box(conn).frames.flatMap((f) => {
      const d = decodeDownFrame(f, this.state.epoch);
      return d.ok ? d.frame.cars : [];
    });
  }

  /** Join `names` (conn ids c1..), ready them all and run to the racing phase. */
  toRacing(names: string[] = ['Ana', 'Ben']): string[] {
    const conns = names.map((name, i) => {
      this.join(`c${i + 1}`, name);
      return `c${i + 1}`;
    });
    for (const c of conns) this.send(c, { type: 'ready', ready: true });
    this.runUntil(this.now + (this.machine.timings.readyCountdownMs + 1));
    for (const c of conns) this.send(c, { type: 'loaded' });
    const start = this.state.start;
    if (!start) throw new Error('no start schedule');
    // Cars sit still on the grid (snapshots keep members active).
    while (this.now < start.lightsOutAt) {
      this.now = Math.min(start.lightsOutAt, this.now + 400);
      this.heartbeat(conns);
      this.advance(0);
    }
    this.advance(1);
    if (this.state.phase !== 'racing') throw new Error(`expected racing, got ${this.state.phase}`);
    return conns;
  }

  private tick = 1;
  /** Each conn sends a stationary snapshot of every car it owns. */
  heartbeat(conns: string[], over: (seat: number) => Partial<CarSnapshot> = () => ({})): void {
    for (const c of conns) {
      const seats = this.ownedSeats(c);
      if (seats.length > 0)
        this.snap(
          c,
          seats.map((seat) => car(seat, { tick: this.tick, t: this.now, ...over(seat) })),
        );
    }
    this.tick++;
  }

  memberOf(conn: string) {
    const id = this.state.conns.find((c) => c.id === conn)?.member;
    return this.state.members.find((m) => m.id === id);
  }

  ownedSeats(conn: string): number[] {
    const m = this.memberOf(conn);
    if (!m || !this.state.cars) return [];
    return this.state.cars
      .filter((c) => (c.kind === 'human' ? c.member === m.id : this.state.host === m.id))
      .map((c) => c.seat);
  }
}

export { CLOSE };
