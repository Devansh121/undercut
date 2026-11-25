import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import {
  Backoff,
  CLOSE,
  ClockSync,
  DEFAULT_BACKOFF,
  DEFAULT_TIMINGS,
  RemoteCarBuffer,
  RoomClient,
  RoomMachine,
  SnapshotScheduler,
  roomSocketUrl,
  roomsApi,
  webSocketTransport,
  type CarSnapshot,
  type Connection,
  type RoomTimings,
  type Timers,
  type Transport,
  type TransportHandlers,
  type WebSocketLike,
} from '../src/index';
import { CODE, TEST_SETTINGS, car } from './harness';

/** Deterministic timers: callbacks run in time order as the clock advances. */
class FakeTimers implements Timers {
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

/**
 * Clients talk to an in-memory RoomMachine through this transport, with a one-way
 * latency each way. The server clock runs `serverAhead` ms ahead of the clients'.
 */
class Loopback implements Transport {
  readonly machine: RoomMachine;
  private readonly handlers = new Map<string, TransportHandlers>();
  private next = 0;
  constructor(
    readonly timers: FakeTimers,
    readonly latency = 20,
    readonly serverAhead = 5_000_000,
    timings: Partial<RoomTimings> = {},
  ) {
    let tok = 0;
    this.machine = RoomMachine.create(
      CODE,
      this.serverNow(),
      { randomInt: () => 0, token: () => (++tok).toString(16).padStart(32, '0') },
      { ...DEFAULT_TIMINGS, ...timings },
      {
        ...RoomMachine.create(CODE, 0, { randomInt: () => 0, token: () => '' }).state.settings,
        ...TEST_SETTINGS,
      },
    );
  }

  serverNow(): number {
    return this.timers.now() + this.serverAhead;
  }

  private deliver(out: ReturnType<RoomMachine['handle']>): void {
    for (const o of out) {
      const targets = o.kind === 'binary' ? o.to : [o.to];
      for (const to of targets) {
        this.timers.setTimeout(() => {
          const h = this.handlers.get(to);
          if (!h) return;
          if (o.kind === 'text') h.onText(o.text);
          else if (o.kind === 'binary') h.onBinary(o.data);
          else {
            this.handlers.delete(to);
            h.onClose(o.code, o.reason);
          }
        }, this.latency);
      }
    }
  }

  tick(): void {
    this.deliver(this.machine.handle({ type: 'tick' }, this.serverNow()));
  }

  /** Drop a connection as a network failure would (no close frame from the server). */
  cut(conn: string): void {
    const h = this.handlers.get(conn);
    this.handlers.delete(conn);
    this.deliver(this.machine.handle({ type: 'close', conn }, this.serverNow()));
    h?.onClose(1006, '');
  }

  conns(): string[] {
    return [...this.handlers.keys()];
  }

  open(_url: string, handlers: TransportHandlers): Connection {
    const id = `k${++this.next}`;
    this.handlers.set(id, handlers);
    this.timers.setTimeout(() => {
      this.deliver(
        this.machine.handle({ type: 'open', conn: id, address: 'loopback' }, this.serverNow()),
      );
      handlers.onOpen();
    }, this.latency);
    const send = (event: { type: 'text'; data: string } | { type: 'binary'; data: Uint8Array }) =>
      this.timers.setTimeout(() => {
        if (!this.handlers.has(id)) return;
        this.deliver(
          this.machine.handle(
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
          this.deliver(this.machine.handle({ type: 'close', conn: id }, this.serverNow()));
          handlers.onClose(1000, '');
        }, this.latency);
      },
    };
  }
}

function client(net: Loopback, name: string, resume?: string) {
  return new RoomClient({
    url: 'wss://example.test/rooms/BCDFGH/ws',
    name,
    transport: net,
    timers: net.timers,
    random: () => 0.5,
    ...(resume ? { resume } : {}),
  });
}

describe('ClockSync', () => {
  it('estimates the offset from symmetric round trips exactly', () => {
    const c = new ClockSync();
    c.add(100, 5_000_150, 200);
    expect(c.offset).toBe(5_000_000);
    // Half the round trip, plus the server clock's 1 ms resolution.
    expect(c.error).toBe(51);
    expect(c.serverTime(300)).toBe(5_000_300);
    expect(c.localTime(5_000_300)).toBe(300);
  });

  it('prefers the fastest round trips, so a congested sample does not skew it', () => {
    const c = new ClockSync();
    for (let i = 0; i < 9; i++) c.add(i * 1000, 1_000_000 + i * 1000 + 20, i * 1000 + 40);
    c.add(20_000, 1_000_000 + 20_000 + 400, 20_000 + 450); // 450 ms RTT, asymmetric
    expect(c.offset).toBe(1_000_000);
    expect(c.error).toBe(21);
  });

  it('bounds the error even when the server clock only has whole milliseconds', () => {
    // A fast loopback round trip (0.4 ms) and a server stamp truncated to the ms below:
    // half the round trip alone would claim 0.2 ms, but truncation costs 0.35 ms.
    const trueOffset = 1_000_000.15;
    const c = new ClockSync();
    for (let i = 0; i < 8; i++) {
      const t0 = 100 + i * 10;
      const serverAt = Math.floor(t0 + 0.2 + trueOffset);
      c.add(t0, serverAt, t0 + 0.4);
    }
    expect(Math.abs((c.offset as number) - trueOffset)).toBeLessThanOrEqual(c.error as number);
  });

  it('has no estimate before a sample and ignores nonsense', () => {
    const c = new ClockSync();
    expect(c.offset).toBeNull();
    c.add(100, Number.NaN, 200);
    c.add(200, 5, 100);
    expect(c.sampleCount).toBe(0);
  });
});

describe('Backoff', () => {
  it('grows exponentially to a cap with bounded jitter', () => {
    const b = new Backoff(DEFAULT_BACKOFF, () => 0.5);
    expect([b.next(), b.next(), b.next(), b.next(), b.next(), b.next()]).toEqual([
      250, 500, 1000, 2000, 4000, 5000,
    ]);
    const lo = new Backoff(DEFAULT_BACKOFF, () => 0).next();
    const hi = new Backoff(DEFAULT_BACKOFF, () => 0.999999).next();
    expect(lo).toBe(188);
    expect(hi).toBe(312);
    b.reset();
    expect(b.next()).toBe(250);
  });
});

describe('SnapshotScheduler', () => {
  it('sends at 30 Hz whatever the frame rate, without bursts after a stall', () => {
    for (const fps of [60, 144, 30.5]) {
      const s = new SnapshotScheduler(30);
      let sent = 0;
      for (let t = 0; t < 10_000; t += 1000 / fps) if (s.take(t, 0)) sent++;
      expect(Math.abs(sent - 300), `${fps} fps`).toBeLessThanOrEqual(3);
    }
    const s = new SnapshotScheduler(30);
    s.take(0, 0);
    let burst = 0;
    for (let t = 5000; t < 5100; t += 1) if (s.take(t, 0)) burst++;
    expect(burst).toBeLessThanOrEqual(4);
  });

  it('skips instead of queueing while the socket is backed up', () => {
    const s = new SnapshotScheduler(30, 1000);
    expect(s.take(0, 5000)).toBe(false);
    expect(s.take(40, 0)).toBe(true);
    expect({ sent: s.sent, skipped: s.skipped }).toEqual({ sent: 1, skipped: 1 });
  });
});

/** A car going round a 100 m circle at 50 m/s. */
function circle(t: number, seat = 1, tick?: number): CarSnapshot {
  const w = 0.5; // rad/s
  const a = (w * t) / 1000;
  return car(seat, {
    tick: tick ?? Math.round(t / 33.33),
    t,
    x: 100 * Math.cos(a),
    z: 100 * Math.sin(a),
    vx: -50 * Math.sin(a),
    vz: 50 * Math.cos(a),
    yaw: a,
    yawRate: w,
  });
}

describe('RemoteCarBuffer', () => {
  it("gathers the senders' broken sets from every record, even ones it drops", () => {
    const b = new RemoteCarBuffer();
    for (let i = 0; i < 64; i++) {
      const snap = {
        ...circle((i * 1000) / 30),
        brokenIndex: i,
        brokenWord: i === 63 ? 0x80000000 : 1 << (i % 32),
      };
      b.push(snap, (i * 1000) / 30 + 50);
      // A duplicate still carries its word.
      if (i === 5) b.push({ ...snap, brokenWord: 4 }, (i * 1000) / 30 + 60);
    }
    expect(b.brokenSet[0]).toBe(1);
    expect(b.brokenSet[5]).toBe((1 << 5) | 4);
    expect(b.brokenSet[63]).toBe(0x80000000);
    b.clear();
    expect(b.brokenSet.every((w) => w === 0)).toBe(true);
  });

  it('interpolates between snapshots with a small error on a curve', () => {
    const b = new RemoteCarBuffer();
    for (let i = 0; i <= 30; i++) b.push(circle((i * 1000) / 30), (i * 1000) / 30 + 50);
    let worst = 0;
    for (let t = 10; t < 990; t += 7) {
      const v = b.sampleSeat(1, t)!;
      const truth = circle(t);
      expect(v.mode).toBe('interpolated');
      worst = Math.max(worst, Math.hypot(v.x - truth.x, v.z - truth.z));
    }
    // A straight line would be off by the chord error, 3.5 mm here; the cubic follows the arc.
    expect(worst).toBeLessThan(0.0005);
  });

  it('follows the curve across gaps left by lost snapshots', () => {
    const b = new RemoteCarBuffer();
    // Every third snapshot arrives: 100 ms gaps, a 5 m step on a 100 m radius.
    for (let i = 0; i <= 30; i += 3) b.push(circle((i * 1000) / 30), (i * 1000) / 30 + 50);
    let worst = 0;
    for (let t = 10; t < 990; t += 7) {
      const v = b.sampleSeat(1, t)!;
      worst = Math.max(worst, Math.hypot(v.x - circle(t).x, v.z - circle(t).z));
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('extrapolates for a bounded time, then holds and fades', () => {
    const b = new RemoteCarBuffer({ maxExtrapolationMs: 250, holdMs: 1000, fadeMs: 500 });
    for (let i = 0; i <= 30; i++) b.push(circle((i * 1000) / 30), (i * 1000) / 30 + 50);
    const last = 1000;
    const ext = b.sampleSeat(1, last + 100)!;
    expect(ext.mode).toBe('extrapolated');
    expect(Math.hypot(ext.x - circle(last + 100).x, ext.z - circle(last + 100).z)).toBeLessThan(
      0.2,
    );
    const held = b.sampleSeat(1, last + 800)!;
    const heldLater = b.sampleSeat(1, last + 1200)!;
    expect(held.mode).toBe('held');
    expect([held.x, held.z]).toEqual([heldLater.x, heldLater.z]);
    expect(held.opacity).toBe(1);
    expect(b.sampleSeat(1, last + 250 + 1000 + 250)!.opacity).toBeCloseTo(0.5, 5);
    expect(b.sampleSeat(1, last + 5000)!.opacity).toBe(0);
  });

  it('sorts out-of-order arrivals and drops duplicates', () => {
    const b = new RemoteCarBuffer();
    const order = [0, 2, 1, 3, 3, 5, 4];
    for (const i of order) b.push(circle(i * 33, 1, i), 100 + i * 33);
    expect(b.accepted).toBe(6);
    expect(b.dropped).toBe(1);
    const v = b.sampleSeat(1, 1.5 * 33)!;
    expect(v.mode).toBe('interpolated');
  });

  it('holds, then snaps, across a reset instead of sweeping through the gap (finding 7)', () => {
    const b = new RemoteCarBuffer();
    const at = (t: number, x: number, resets: number) =>
      car(1, { t, tick: Math.round(t), x, z: 0, vx: 0, vz: 0, resets });
    b.push(at(0, 0, 0), 50);
    b.push(at(33, 0, 0), 83);
    b.push(at(66, 100, 1), 116); // reset to track: 100 m away, stationary
    b.push(at(99, 100, 1), 149);
    for (let t = 34; t < 66; t += 4) expect(b.sampleSeat(1, t)!.x).toBe(0);
    expect(b.sampleSeat(1, 66)!.x).toBe(100);
    expect(b.sampleSeat(1, 80)!.x).toBe(100);
  });

  it('treats a jump the velocities cannot explain as a reset even without the counter', () => {
    const b = new RemoteCarBuffer();
    const at = (t: number, x: number) => car(1, { t, tick: Math.round(t), x, vx: 80 });
    b.push(at(0, 0), 50);
    b.push(at(33, 2.64), 83);
    b.push(at(66, 300), 116); // 297 m in 33 ms at 80 m/s
    b.push(at(99, 302.64), 149);
    for (let t = 34; t < 66; t += 4) expect(b.sampleSeat(1, t)!.x).toBeLessThan(5.3);
    expect(b.sampleSeat(1, 70)!.x).toBeGreaterThan(300);
    // An ordinary 33 ms step at 80 m/s still interpolates smoothly.
    const mid = b.sampleSeat(1, 16.5)!.x;
    expect(mid).toBeCloseTo(1.32, 2);
  });

  it('stays bounded in size', () => {
    const b = new RemoteCarBuffer({ capacity: 10 });
    for (let i = 0; i < 1000; i++) b.push(circle(i * 33, 1 + (i % 3), i), i * 33 + 80);
    expect(b.size).toBe(30);
  });

  it('sizes the delay from transit and jitter', () => {
    const steady = new RemoteCarBuffer();
    const jittery = new RemoteCarBuffer();
    const rng = createRng(3);
    for (let i = 0; i < 300; i++) {
      const t = i * 33.3;
      steady.push(circle(t, 1, i), t + 150);
      jittery.push(circle(t, 1, i), t + 150 + rng.range(-50, 50));
    }
    expect(steady.targetDelayMs()).toBeGreaterThan(150 + 33);
    expect(steady.targetDelayMs()).toBeLessThan(150 + 40);
    expect(jittery.targetDelayMs()).toBeGreaterThan(steady.targetDelayMs() + 40);
  });

  it('slews the delay instead of jumping', () => {
    const b = new RemoteCarBuffer({ delaySlewMs: 2 });
    for (let i = 0; i < 30; i++) b.push(circle(i * 33, 1, i), i * 33 + 50);
    b.sample(2000);
    const before = b.delayMs;
    for (let i = 30; i < 60; i++) b.push(circle(i * 33, 1, i), i * 33 + 400);
    b.sample(3000);
    expect(b.delayMs - before).toBeLessThanOrEqual(2);
  });
});

describe('RoomClient over a loopback room', () => {
  it('joins, syncs the clock and sees the room', () => {
    const timers = new FakeTimers();
    const net = new Loopback(timers, 20);
    const a = client(net, 'Ana');
    const statuses: string[] = [];
    a.on('status', (s) => statuses.push(s));
    a.connect();
    timers.advance(2000);
    expect(statuses).toEqual(['connecting', 'joined']);
    expect(a.me).toBe('m1');
    expect(a.isHost).toBe(true);
    expect(a.room?.members.map((m) => m.name)).toEqual(['Ana']);
    expect(a.clock.sampleCount).toBeGreaterThanOrEqual(6);
    expect(Math.abs((a.serverNow() as number) - net.serverNow())).toBeLessThanOrEqual(
      a.clock.error as number,
    );
  });

  it('reconnects with backoff after a drop and takes the same seat back', () => {
    const timers = new FakeTimers();
    const net = new Loopback(timers, 20);
    const a = client(net, 'Ana');
    const b = client(net, 'Ben');
    a.connect();
    b.connect();
    timers.advance(1000);
    const token = b.resumeToken;
    const statuses: string[] = [];
    b.on('status', (s) => statuses.push(s));
    net.cut(net.conns()[1] as string);
    timers.advance(3000);
    expect(statuses).toEqual(['reconnecting', 'joined']);
    expect(b.me).toBe('m2');
    expect(b.seat).toBe(1);
    expect(b.resumeToken).toBe(token);
    expect(a.room?.members.find((m) => m.id === 'm2')?.connected).toBe(true);
  });

  it('queues timing reports while reconnecting and sends them after', () => {
    const timers = new FakeTimers();
    const net = new Loopback(timers, 20);
    const a = client(net, 'Ana');
    a.connect();
    timers.advance(1000);
    net.cut(net.conns()[0] as string);
    expect(a.reportLimits(0, 1)).toBe(false);
    expect(a.setReady(true)).toBe(false);
    expect(a.snapshotStats.queuedReports).toBe(1);
    const errors: string[] = [];
    a.on('error', (e) => errors.push(e.code));
    timers.advance(3000);
    expect(a.snapshotStats.queuedReports).toBe(0);
    // Sent after the resume; the lobby refuses it, which shows it arrived.
    expect(errors).toEqual(['wrong_phase']);
  });

  it('stops for good when kicked, with the reason', () => {
    const timers = new FakeTimers();
    const net = new Loopback(timers, 20);
    const a = client(net, 'Ana');
    const b = client(net, 'Ben');
    a.connect();
    b.connect();
    timers.advance(1000);
    const closed: unknown[] = [];
    b.on('closed', (e) => closed.push(e));
    a.kick('m2');
    timers.advance(10_000);
    expect(b.status).toBe('closed');
    expect(closed).toMatchObject([{ code: CLOSE.kicked, error: { code: 'kicked' } }]);
  });

  it('runs a race: start schedule, snapshots both ways, interpolated remote cars', () => {
    const timers = new FakeTimers();
    const net = new Loopback(timers, 30, 5_000_000, {
      readyCountdownMs: 100,
      formationMs: 200,
      lightIntervalMs: 100,
    });
    const a = client(net, 'Ana');
    const b = client(net, 'Ben');
    const starts: unknown[] = [];
    a.on('start', (s) => starts.push(s));
    b.on('start', (s) => starts.push(s));
    a.connect();
    b.connect();
    timers.advance(1000);
    a.setReady(true);
    b.setReady(true);
    for (let i = 0; i < 20; i++) {
      timers.advance(50);
      net.tick();
    }
    expect(a.room?.phase).toBe('grid');
    expect(a.ownedSeats()).toEqual([0, 2, 3]);
    expect(b.ownedSeats()).toEqual([1]);
    a.markLoaded();
    b.markLoaded();
    timers.advance(200);
    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual(starts[1]);
    // Both clients drive for 3 s; each sees the other's car.
    for (let ms = 0; ms < 6000; ms += 10) {
      timers.advance(10);
      net.tick();
      const sa = a.serverNow()!;
      const sb = b.serverNow()!;
      a.sendSnapshots(a.ownedSeats().map((seat) => circle(sa, seat, Math.round(ms / 10))));
      b.sendSnapshots(b.ownedSeats().map((seat) => circle(sb, seat, Math.round(ms / 10))));
    }
    expect(a.room?.phase).toBe('racing');
    expect(a.remoteCars.seatList).toEqual([1]);
    expect(b.remoteCars.seatList).toEqual([0, 2, 3]);
    const now = b.serverNow()!;
    const views = b.remoteCars.sample(now);
    for (const v of views) {
      expect(v.mode).toBe('interpolated');
      const truth = circle(now - b.remoteCars.delayMs, v.seat);
      expect(Math.hypot(v.x - truth.x, v.z - truth.z)).toBeLessThan(0.05);
    }
    expect(a.snapshotStats.sent).toBeGreaterThan(170);
    expect(a.snapshotStats.sent).toBeLessThan(190);
  });

  it('waits for a matching epoch when control delivery misses activation and the old look-back', () => {
    const timers = new FakeTimers();
    const net = new Loopback(timers, 75, 5_000_000, {
      readyCountdownMs: 100,
      formationMs: 200,
      lightIntervalMs: 100,
    });
    const a = client(net, 'Ana');
    let delayOrders = false;
    const b = new RoomClient({
      url: 'wss://example.test/rooms/BCDFGH/ws',
      name: 'Ben',
      timers,
      random: () => 0.5,
      transport: {
        open: (url, handlers) =>
          net.open(url, {
            ...handlers,
            onText: (text) => {
              if (delayOrders && JSON.parse(text).type === 'order')
                timers.setTimeout(() => handlers.onText(text), 900);
              else handlers.onText(text);
            },
          }),
      },
    });
    a.connect();
    b.connect();
    timers.advance(2000);
    a.changeSettings({ aiCount: 0 });
    timers.advance(300);
    a.setReady(true);
    b.setReady(true);
    for (let i = 0; i < 20; i++) {
      timers.advance(50);
      net.tick();
    }
    a.markLoaded();
    b.markLoaded();
    for (let i = 0; i < 100; i++) {
      timers.advance(20);
      net.tick();
    }
    expect(a.room?.phase).toBe('racing');
    expect(b.room?.phase).toBe('racing');
    delayOrders = true;
    for (let i = 0; i < 40; i++) {
      timers.advance(20);
      net.tick();
    }
    const target = a.orderAt(net.serverNow() - 300)!;
    expect(target).not.toBeNull();
    // The same query time alone cannot establish receipt: the guest still has an older epoch.
    expect(b.orderAt(target.at)!.at).toBeLessThan(target.at);
    const received = () =>
      [a, b].every(
        (c) => c.orderAt(target.at)?.at === target.at && c.orderAt(c.serverNow()!)!.at >= target.at,
      );
    expect(received()).toBe(false);
    // Bound delivery using deterministic timers, with no new publication to move the target.
    timers.advance(900);
    expect(received()).toBe(true);
    expect(a.orderAt(target.at)).toEqual(b.orderAt(target.at));
  });

  it('activates the service-published running order identically across clients at 150 ms RTT', () => {
    const timers = new FakeTimers();
    const net = new Loopback(timers, 75, 5_000_000, {
      readyCountdownMs: 100,
      formationMs: 200,
      lightIntervalMs: 100,
    });
    const a = client(net, 'Ana');
    const b = client(net, 'Ben');
    a.connect();
    b.connect();
    timers.advance(2000);
    a.changeSettings({ aiCount: 0 });
    timers.advance(300);
    a.setReady(true);
    b.setReady(true);
    for (let i = 0; i < 20; i++) {
      timers.advance(50);
      net.tick();
    }
    expect(a.room?.phase).toBe('grid');
    a.markLoaded();
    b.markLoaded();
    let seenOrders = 0;
    let firstOrder: { at: number; order: number[] } | null = null;
    let swapped = false;
    for (let ms = 0; ms < 4000; ms += 20) {
      timers.advance(20);
      net.tick();
      const sa = a.serverNow()!;
      const sb = b.serverNow()!;
      // Both cars coast side by side at 50 m/s for the first 2 s, then seat 1 pulls ahead.
      const tSec = ms / 1000;
      const s0 = 100 + 50 * tSec;
      const s1 = tSec < 2 ? 100 + 50 * tSec : 100 + 50 * tSec + 8 * (tSec - 2);
      const tick = Math.round(ms / 20) + 1;
      a.sendSnapshots([{ ...circle(sa, 0, tick), s: s0, vx: 50, vz: 0 }]);
      b.sendSnapshots([{ ...circle(sb, 1, tick), s: s1, vx: 50, vz: 0 }]);
      if (a.room?.phase === 'racing' && b.room?.phase === 'racing') {
        const oa = a.orderAt(sa);
        const ob = b.orderAt(sb);
        if (oa && ob) {
          seenOrders++;
          firstOrder ??= { at: oa.at, order: [...oa.order] };
          expect(oa.order).toEqual(ob.order);
          if (oa.order[0] === 1) swapped = true;
        }
      }
    }
    expect(seenOrders).toBeGreaterThan(50);
    expect(swapped).toBe(true);
    expect(a.orderAt(firstOrder!.at)?.order).toEqual(firstOrder!.order);
    expect(b.orderAt(firstOrder!.at)?.order).toEqual(firstOrder!.order);
  });
});

describe('URLs and the HTTP API', () => {
  it('builds the room socket URL from the rooms setting', () => {
    expect(roomSocketUrl('https://h.test/rooms', 'BCDFGH')).toBe('wss://h.test/rooms/BCDFGH/ws');
    expect(roomSocketUrl('http://h.test:8080/rooms/', 'BCDFGH')).toBe(
      'ws://h.test:8080/rooms/BCDFGH/ws',
    );
  });

  it('creates and looks up rooms through an injected fetch', async () => {
    const calls: string[] = [];
    const api = roomsApi('https://h.test/rooms', async (url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST') return { status: 201, json: async () => ({ code: 'BCDFGH' }) };
      return url.endsWith('BCDFGH')
        ? { status: 200, json: async () => ({ phase: 'lobby', humans: 1, joinable: true }) }
        : { status: 404, json: async () => ({ error: 'not_found' }) };
    });
    expect(await api.create()).toEqual({ code: 'BCDFGH' });
    expect(await api.info('BCDFGH')).toMatchObject({ joinable: true });
    expect(await api.info('ZZZZZZ')).toBeNull();
    expect(calls).toEqual([
      'POST https://h.test/rooms',
      'GET https://h.test/rooms/BCDFGH',
      'GET https://h.test/rooms/ZZZZZZ',
    ]);
  });
});

describe('webSocketTransport', () => {
  it('adapts a WHATWG-style socket and reports one close', () => {
    const sent: unknown[] = [];
    let sock!: WebSocketLike & Record<string, unknown>;
    const transport = webSocketTransport(() => {
      sock = {
        binaryType: 'blob',
        bufferedAmount: 7,
        readyState: 1,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: (d: unknown) => sent.push(d),
        close: () => {},
      };
      return sock;
    });
    const events: unknown[] = [];
    const conn = transport.open('ws://x', {
      onOpen: () => events.push('open'),
      onText: (t) => events.push(t),
      onBinary: (d) => events.push([...d]),
      onClose: (code) => events.push(code),
    });
    const fire = (name: string, ev: unknown) => (sock[name] as (e: unknown) => void)(ev);
    expect(sock.binaryType).toBe('arraybuffer');
    fire('onopen', {});
    fire('onmessage', { data: 'hi' });
    fire('onmessage', { data: new Uint8Array([1, 2]).buffer });
    fire('onclose', { code: 1006, reason: '' });
    fire('onclose', { code: 1006, reason: '' });
    conn.sendText('x');
    expect(conn.bufferedAmount).toBe(7);
    expect(events).toEqual(['open', 'hi', [1, 2], 1006]);
    expect(sent).toEqual(['x']);
  });
});
