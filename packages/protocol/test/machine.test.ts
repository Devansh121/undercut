import { describe, expect, it } from 'vitest';
import {
  CLOSE,
  LIMITS,
  MAX_HUMANS,
  PHASES,
  PHASE_ACCEPTS,
  PROTOCOL_VERSION,
  RoomMachine,
  encodeUpFrame,
  type ClientMessage,
  type LapMessage,
  type Phase,
} from '../src/index';
import { CODE, Harness, T0, TEST_SETTINGS, car } from './harness';

const ready = (r = true) => ({ type: 'ready', ready: r }) as const;

/** Drive two humans to the given phase. */
function inPhase(phase: Phase): { h: Harness; conns: string[] } {
  const h = new Harness();
  if (phase === 'lobby') {
    h.join('c1', 'Ana');
    h.join('c2', 'Ben');
    return { h, conns: ['c1', 'c2'] };
  }
  if (phase === 'closed') {
    h.join('c1', 'Ana');
    h.send('c1', { type: 'leave' });
    h.runUntil(h.now + h.machine.timings.roomLingerMs + 1);
    return { h, conns: ['c1'] };
  }
  h.join('c1', 'Ana');
  h.join('c2', 'Ben');
  h.send('c1', ready());
  h.send('c2', ready());
  h.runUntil(h.now + h.machine.timings.readyCountdownMs);
  if (phase === 'grid') return { h, conns: ['c1', 'c2'] };
  h.send('c1', { type: 'loaded' });
  h.send('c2', { type: 'loaded' });
  if (phase === 'formation') return { h, conns: ['c1', 'c2'] };
  const start = h.state.start!;
  if (phase === 'lights') {
    h.runUntil(start.lightsStartAt);
    return { h, conns: ['c1', 'c2'] };
  }
  while (h.now < start.lightsOutAt) {
    h.now = Math.min(start.lightsOutAt, h.now + 400);
    h.heartbeat(['c1', 'c2']);
    h.advance(0);
  }
  h.advance(1);
  if (phase === 'racing') return { h, conns: ['c1', 'c2'] };
  // Ana wins: run three laps for every car (host c1 reports the AI).
  driveLaps(h, ['c1', 'c2'], 3, { stopAfterFirstFinisher: phase === 'finished' });
  if (phase === 'finished') return { h, conns: ['c1', 'c2'] };
  if (h.state.phase !== 'results') throw new Error(`expected results, got ${h.state.phase}`);
  return { h, conns: ['c1', 'c2'] };
}

/**
 * Drive every car round the 600 m test loop: seat i laps in 7 s + 100 ms x grid
 * position, sending snapshots every 100 ms and a lap message at each crossing.
 */
function driveLaps(
  h: Harness,
  conns: string[],
  laps: number,
  opts: { stopAfterFirstFinisher?: boolean; skip?: (seat: number) => boolean } = {},
): void {
  const start = h.state.start!;
  const lapTime = (seat: number) =>
    7000 + 100 * (h.state.cars!.find((c) => c.seat === seat)!.gridPosition - 1);
  const done = new Map<number, number>();
  for (let step = 0; step < 10_000; step++) {
    if (h.state.phase !== 'racing' && h.state.phase !== 'finished') return;
    const raceMs = h.now - start.lightsOutAt;
    for (const c of conns) {
      const seats = h.ownedSeats(c).filter((seat) => !opts.skip?.(seat));
      const owner = c;
      for (const seat of seats) {
        const lt = lapTime(seat);
        const completed = Math.floor(raceMs / lt);
        const prev = done.get(seat) ?? 0;
        const carRec = h.state.cars!.find((x) => x.seat === seat)!;
        if (completed > prev && prev < laps && carRec.state === 'racing') {
          const lap = prev + 1;
          done.set(seat, lap);
          const lapMsg: LapMessage = {
            type: 'lap',
            seat,
            lap,
            lapMs: lt,
            raceMs: lap * lt,
            sectorsMs: [lt / 2 - 500, lt / 4 + 250, lt / 4 + 250].map(Math.round),
            tick: step,
            s: 0.5,
            speed: 80,
            at: start.lightsOutAt + lap * lt,
          };
          h.send(owner, lapMsg);
          if (opts.stopAfterFirstFinisher && h.state.phase === 'finished') return;
        }
      }
      if (seats.length > 0) {
        h.snap(
          owner,
          seats.map((seat) => {
            const lt = lapTime(seat);
            const d = (Math.min(raceMs, laps * lt) / lt) * 600;
            return car(seat, {
              tick: step + 1,
              t: h.now,
              lap: Math.floor(d / 600),
              s: d % 600,
              vx: 80,
            });
          }),
        );
      }
    }
    h.now += 100;
    h.advance(0);
  }
}

describe('lobby', () => {
  it('welcomes the first member as host on seat 0 and tells everyone who is in', () => {
    const h = new Harness();
    const a = h.join('c1', 'Ana');
    expect(a).toMatchObject({
      you: 'm1',
      seat: 0,
      v: PROTOCOL_VERSION,
      epoch: T0,
      room: { code: CODE, host: 'm1', phase: 'lobby' },
    });
    expect(a.resume).toMatch(/^[0-9a-f]{32}$/);
    const b = h.join('c2', '  Ben​ ');
    expect(b).toMatchObject({ you: 'm2', seat: 1 });
    const room = h.last('c1', 'room')!.room;
    expect(room.members.map((m) => [m.id, m.name, m.seat])).toEqual([
      ['m1', 'Ana', 0],
      ['m2', 'Ben', 1],
    ]);
    // Two AI in the test settings, on the lowest free seats.
    expect(room.aiSeats).toEqual([2, 3]);
  });

  it('caps AI so humans plus AI never exceed twenty', () => {
    const h = new Harness({}, { ...TEST_SETTINGS, aiCount: 19 });
    for (let i = 1; i <= 3; i++) h.join(`c${i}`, `P${i}`);
    expect(h.machine.view().aiSeats).toHaveLength(17);
  });

  it('refuses a ninth human', () => {
    const h = new Harness();
    for (let i = 1; i <= MAX_HUMANS; i++) h.join(`c${i}`, `P${i}`);
    h.open('c9');
    h.send('c9', { type: 'join', v: PROTOCOL_VERSION, name: 'Late' });
    expect(h.last('c9', 'error')).toMatchObject({ code: 'room_full' });
    expect(h.box('c9').closed).toMatchObject({ code: CLOSE.roomFull });
    expect(h.machine.info()).toMatchObject({ humans: 8, joinable: false });
  });

  it.each([
    [{ name: '​' }, 'name_invalid', CLOSE.nameInvalid],
    [{ v: 1 }, 'version_mismatch', CLOSE.versionMismatch],
    [{ resume: 'f'.repeat(32) }, 'resume_invalid', CLOSE.resumeInvalid],
  ])('refuses a join with %j', (fields, code, close) => {
    const h = new Harness();
    h.open('c1');
    h.send('c1', { type: 'join', v: PROTOCOL_VERSION, name: 'Ana', ...fields });
    expect(h.last('c1', 'error')).toMatchObject({ code });
    if (close !== null) expect(h.box('c1').closed?.code).toBe(close);
    expect(h.state.members).toHaveLength(0);
  });

  it('answers messages before join with not_joined, and a second join with already_joined', () => {
    const h = new Harness();
    h.open('c1');
    h.send('c1', ready());
    expect(h.last('c1', 'error')).toMatchObject({ code: 'not_joined' });
    h.join('c1', 'Ana');
    h.send('c1', { type: 'join', v: PROTOCOL_VERSION, name: 'Again' });
    expect(h.last('c1', 'error')).toMatchObject({ code: 'already_joined' });
  });

  it('closes a socket that does not join in time', () => {
    const h = new Harness();
    h.open('c1');
    h.runUntil(T0 + h.machine.timings.joinTimeoutMs);
    expect(h.box('c1').closed).toMatchObject({ code: CLOSE.joinTimeout });
    expect(h.state.conns).toHaveLength(0);
  });

  it('runs a ready countdown that any change cancels', () => {
    const h = new Harness();
    h.join('c1', 'Ana');
    h.join('c2', 'Ben');
    h.send('c1', ready());
    expect(h.state.phaseEndsAt).toBeNull();
    h.send('c2', ready());
    expect(h.state.phaseEndsAt).toBe(h.now + h.machine.timings.readyCountdownMs);
    h.send('c2', ready(false));
    expect(h.state.phaseEndsAt).toBeNull();
    h.send('c2', ready());
    h.runUntil(h.now + h.machine.timings.readyCountdownMs);
    expect(h.state.phase).toBe('grid');
  });

  it('lets only the host change settings, clears ready, and rejects inconsistent ones', () => {
    const h = new Harness();
    h.join('c1', 'Ana');
    h.join('c2', 'Ben');
    h.send('c2', ready());
    h.send('c2', { type: 'settings', patch: { laps: 7 } });
    expect(h.last('c2', 'error')).toMatchObject({ code: 'not_host' });
    h.send('c1', { type: 'settings', patch: { laps: 7, aiCount: 5 } });
    const room = h.last('c2', 'room')!.room;
    expect(room.settings).toMatchObject({ laps: 7, aiCount: 5 });
    expect(room.members.every((m) => !m.ready)).toBe(true);
    const circuit = { ...TEST_SETTINGS.circuit!, maxLapMs: 1000 };
    h.send('c1', { type: 'settings', patch: { circuit } });
    expect(h.last('c1', 'error')).toMatchObject({ code: 'bad_settings' });
  });

  it('frees the seat of a member who leaves', () => {
    const h = new Harness();
    h.join('c1', 'Ana');
    h.join('c2', 'Ben');
    h.send('c2', { type: 'leave' });
    expect(h.box('c2').closed).toMatchObject({ code: CLOSE.left });
    expect(h.state.members.map((m) => m.id)).toEqual(['m1']);
    expect(h.join('c3', 'Cy').seat).toBe(1);
  });
});

describe('grid and start', () => {
  it('builds the grid with humans and AI, in join order when asked', () => {
    const { h } = inPhase('grid');
    expect(h.state.cars!.map((c) => [c.seat, c.kind, c.gridPosition])).toEqual([
      [0, 'human', 1],
      [1, 'human', 2],
      [2, 'ai', 3],
      [3, 'ai', 4],
    ]);
  });

  it('shuffles the grid with the injected randomness for a random grid', () => {
    const h = new Harness({}, { ...TEST_SETTINGS, gridOrder: 'random', aiCount: 18 });
    h.join('c1', 'Ana');
    h.join('c2', 'Ben');
    h.send('c1', ready());
    h.send('c2', ready());
    h.runUntil(h.now + 5000);
    const seats = h.state.cars!.map((c) => c.seat);
    expect([...seats].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(seats).not.toEqual([...seats].sort((a, b) => a - b));
  });

  it('starts the formation once everyone has loaded, with one start schedule for all', () => {
    const { h } = inPhase('grid');
    h.send('c1', { type: 'loaded' });
    expect(h.state.phase).toBe('grid');
    h.send('c2', { type: 'loaded' });
    expect(h.state.phase).toBe('formation');
    const t = h.machine.timings;
    const a = h.last('c1', 'start')!;
    const b = h.last('c2', 'start')!;
    expect(b).toEqual(a);
    expect(a.lightsStartAt).toBe(h.now + t.formationMs);
    const hold = a.lightsOutAt - a.lightsStartAt - (t.lightCount - 1) * t.lightIntervalMs;
    expect(hold).toBeGreaterThanOrEqual(t.holdMinMs);
    expect(hold).toBeLessThanOrEqual(t.holdMaxMs);
  });

  it('chooses a different random hold from different randomness', () => {
    const holds = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      let i = seed;
      const m = RoomMachine.create(CODE, T0, {
        randomInt: (n) => (i = (i * 7 + 3) % 9973) % n,
        token: () => 'a'.repeat(32),
      });
      m.handle({ type: 'open', conn: 'c', address: 'a' }, T0);
      m.handle(
        {
          type: 'text',
          conn: 'c',
          data: JSON.stringify({ type: 'join', v: PROTOCOL_VERSION, name: 'A' }),
        },
        T0,
      );
      m.handle({ type: 'text', conn: 'c', data: JSON.stringify(ready()) }, T0);
      m.handle({ type: 'tick' }, T0 + 10_000);
      m.handle({ type: 'text', conn: 'c', data: '{"type":"loaded"}' }, T0 + 10_000);
      holds.add(m.state.start!.lightsOutAt);
    }
    expect(holds.size).toBeGreaterThan(10);
  });

  it('forms anyway when the grid times out', () => {
    const { h } = inPhase('grid');
    h.send('c1', { type: 'loaded' });
    h.runUntil(h.now + h.machine.timings.gridTimeoutMs);
    expect(h.state.phase).toBe('formation');
  });

  it('goes through lights to racing at exactly lights out', () => {
    const { h } = inPhase('formation');
    const start = h.state.start!;
    h.runUntil(start.lightsStartAt);
    expect(h.state.phase).toBe('lights');
    h.runUntil(start.lightsOutAt - 1);
    expect(h.state.phase).toBe('lights');
    h.runUntil(start.lightsOutAt);
    expect(h.state.phase).toBe('racing');
  });

  it('penalises a car that moves before lights out, once, from its snapshots', () => {
    const { h } = inPhase('lights');
    h.snap('c2', [car(1, { tick: 5, vx: 3 })]);
    h.snap('c2', [car(1, { tick: 6, vx: 4 })]);
    const penalties = h.all('c1', 'penalty');
    expect(penalties).toEqual([
      {
        type: 'penalty',
        seat: 1,
        ms: LIMITS.jumpPenaltyMs,
        reason: 'jump_start',
        totalMs: LIMITS.jumpPenaltyMs,
      },
    ]);
  });

  it('accepts a self-reported jump start and ignores a report for someone else', () => {
    const { h } = inPhase('lights');
    h.send('c2', { type: 'jump_start', seat: 0 });
    expect(h.last('c2', 'error')).toMatchObject({ code: 'not_owner' });
    h.send('c2', { type: 'jump_start', seat: 1 });
    expect(h.last('c1', 'penalty')).toMatchObject({ seat: 1, reason: 'jump_start' });
  });
});

describe('snapshots', () => {
  it('relays to everyone else, stamped with the server receive time', () => {
    const { h } = inPhase('racing');
    h.clear();
    h.snap('c2', [car(1, { tick: 9999, x: 12.5 })]);
    expect(h.relayed('c2')).toEqual([]);
    const relayed = h.relayed('c1');
    expect(relayed).toHaveLength(1);
    expect(relayed[0]).toMatchObject({ seat: 1, x: 12.5 });
    expect(h.box('c1').frames[0]![0]).toBe(2);
  });

  it('lets the host send AI cars but nobody send a car they do not drive', () => {
    const { h } = inPhase('racing');
    h.clear();
    h.snap('c1', [car(0, { tick: 9999 }), car(2, { tick: 9999 }), car(3, { tick: 9999 })]);
    expect(h.relayed('c2').map((c) => c.seat)).toEqual([0, 2, 3]);
    h.snap('c2', [car(1, { tick: 10_000 }), car(2, { tick: 10_000 })]);
    expect(h.relayed('c1').map((c) => c.seat)).toEqual([1]);
    expect(h.last('c2', 'error')).toMatchObject({ code: 'not_owner' });
  });

  it('drops stale and duplicate snapshots', () => {
    const { h } = inPhase('racing');
    h.clear();
    h.snap('c2', [car(1, { tick: 9000 })]);
    h.snap('c2', [car(1, { tick: 9000 })]);
    h.snap('c2', [car(1, { tick: 8999 })]);
    h.snap('c2', [car(1, { tick: 9001 })]);
    expect(h.relayed('c1').map((c) => c.tick)).toEqual([9000, 9001]);
  });

  it('ignores snapshots in the lobby and rejects malformed frames', () => {
    const { h } = inPhase('lobby');
    h.snap('c1', [car(0)]);
    expect(h.box('c2').frames).toHaveLength(0);
    h.binary('c1', new Uint8Array([1, 1, 2]));
    expect(h.last('c1', 'error')).toMatchObject({ code: 'bad_message' });
    h.binary('c1', new Uint8Array(2000));
    expect(h.last('c1', 'error')).toMatchObject({ code: 'too_large' });
  });

  it('marks a silent racer stale, then away with grace, and active again on a snapshot', () => {
    const { h } = inPhase('racing');
    const t = h.machine.timings;
    const silentFrom = h.now;
    for (let ms = 0; ms <= t.staleMs + 100; ms += 100) {
      h.now = silentFrom + ms;
      h.heartbeat(['c1']);
      h.advance(0);
    }
    expect(h.memberOf('c2')!.status).toBe('stale');
    for (let ms = t.staleMs + 100; ms <= t.awayMs + 100; ms += 100) {
      h.now = silentFrom + ms;
      h.heartbeat(['c1']);
      h.advance(0);
    }
    const m = h.memberOf('c2')!;
    expect(m.status).toBe('away');
    expect(m.graceUntil).not.toBeNull();
    h.snap('c2', [car(1, { tick: 99_999 })]);
    expect(h.memberOf('c2')).toMatchObject({ status: 'active', graceUntil: null });
  });
});

describe('a full race', () => {
  it('classifies every car the same way for everyone and goes back to the lobby on rematch', () => {
    const { h } = inPhase('results');
    const a = h.last('c1', 'results')!;
    const b = h.last('c2', 'results')!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.results.reason).toBe('complete');
    expect(a.results.rows.map((r) => [r.seat, r.status, r.laps])).toEqual([
      [0, 'finished', 3],
      [1, 'finished', 3],
      [2, 'finished', 3],
      [3, 'finished', 3],
    ]);
    expect(a.results.rows[0]).toMatchObject({
      kind: 'human',
      name: 'Ana',
      timeMs: 21_000,
      bestLapMs: 7000,
    });
    expect(a.results.rows[2]).toMatchObject({ kind: 'ai', aiIndex: 0 });

    h.send('c2', { type: 'rematch' });
    expect(h.last('c2', 'error')).toMatchObject({ code: 'not_host' });
    h.send('c1', { type: 'rematch' });
    const room = h.last('c2', 'room')!.room;
    expect(room).toMatchObject({ phase: 'lobby', grid: null, start: null });
    expect(room.members.map((m) => [m.id, m.ready])).toEqual([
      ['m1', false],
      ['m2', false],
    ]);
    expect(room.settings).toEqual({ ...h.state.settings });
  });

  it('returns to the lobby by itself after the results linger', () => {
    const { h } = inPhase('results');
    h.runUntil(h.now + h.machine.timings.resultsLingerMs);
    expect(h.state.phase).toBe('lobby');
  });

  it('chequers the leader and finishes the others on their next crossing', () => {
    const { h } = inPhase('finished');
    expect(h.state.chequeredAt).not.toBeNull();
    expect(h.state.cars!.find((c) => c.seat === 0)!.state).toBe('finished');
    expect(h.state.cars!.filter((c) => c.state === 'racing')).toHaveLength(3);
  });

  it('decides who took the flag by race time, not by the order messages arrive', () => {
    const { h } = inPhase('racing');
    const out = h.state.start!.lightsOutAt;
    const lap = (conn: string, seat: number, n: number, raceMs: number, lapMs: number) => {
      h.now = Math.max(h.now, out + raceMs + 100);
      h.send(conn, {
        type: 'lap',
        seat,
        lap: n,
        lapMs,
        raceMs,
        tick: n,
        s: 1,
        speed: 80,
        at: out + raceMs,
      });
    };
    lap('c1', 0, 1, 7000, 7000);
    lap('c2', 1, 1, 7500, 7500);
    lap('c1', 2, 1, 10_000, 10_000);
    lap('c1', 3, 1, 10_500, 10_500);
    lap('c1', 0, 2, 14_000, 7000);
    lap('c2', 1, 2, 15_000, 7500);
    // Seat 3 crosses after the leader's finish, but its message arrives first.
    lap('c1', 3, 2, 21_500, 11_000);
    expect(h.state.phase).toBe('racing');
    lap('c1', 0, 3, 21_000, 7000);
    expect(h.state.phase).toBe('finished');
    expect(h.state.cars!.find((c) => c.seat === 3)).toMatchObject({ state: 'finished', lap: 2 });
    // Seat 2 crossed before the leader's finish, but its message arrives after: it races on.
    lap('c1', 2, 2, 20_000, 10_000);
    expect(h.state.cars!.find((c) => c.seat === 2)).toMatchObject({ state: 'racing', lap: 2 });
    lap('c2', 1, 3, 22_500, 7500);
    lap('c1', 2, 3, 30_000, 10_000);
    const rows = h.last('c2', 'results')!.results.rows;
    expect(rows.map((r) => [r.seat, r.laps, r.timeMs, r.status])).toEqual([
      [0, 3, 21_000, 'finished'],
      [1, 3, 22_500, 'finished'],
      [2, 3, 30_000, 'finished'],
      [3, 2, 21_500, 'finished'],
    ]);
  });

  it('ends at the finish window with unfinished cars still running', () => {
    const { h } = inPhase('finished');
    h.runUntil(h.state.phaseEndsAt!);
    const rows = h.last('c1', 'results')!.results.rows;
    expect(rows[0]).toMatchObject({ seat: 0, status: 'finished' });
    expect(rows.slice(1).every((r) => r.status === 'running')).toBe(true);
  });

  it('ends at the race time cap', () => {
    const { h } = inPhase('racing');
    const cap = h.state.phaseEndsAt!;
    while (h.state.phase === 'racing' && h.now < cap + 1000) {
      h.now += 500;
      h.heartbeat(['c1', 'c2']);
      h.advance(0);
    }
    expect(h.last('c1', 'results')!.results.reason).toBe('time_cap');
  });

  it('applies track-limit penalties after three free warnings', () => {
    const { h } = inPhase('racing');
    for (let i = 0; i < 5; i++) h.send('c2', { type: 'limits', seat: 1, lap: 1 });
    expect(h.all('c1', 'limits').map((l) => l.warnings)).toEqual([1, 2, 3, 4, 5]);
    expect(h.last('c1', 'penalty')).toMatchObject({
      seat: 1,
      reason: 'track_limits',
      totalMs: 2 * LIMITS.limitsPenaltyMs,
    });
  });

  it('relays pit events and retires a car on request', () => {
    const { h } = inPhase('racing');
    h.send('c2', { type: 'pit', seat: 1, event: 'entry', lap: 0, at: h.now });
    expect(h.last('c1', 'pit')).toMatchObject({ seat: 1, event: 'entry' });
    h.send('c2', { type: 'retire', seat: 1 });
    expect(h.last('c1', 'room')!.room.grid!.find((g) => g.seat === 1)!.state).toBe('dnf');
  });

  it('rejects a lap from someone who does not drive that car', () => {
    const { h } = inPhase('racing');
    h.send('c2', {
      type: 'lap',
      seat: 0,
      lap: 1,
      lapMs: 7000,
      raceMs: 7000,
      tick: 1,
      s: 1,
      speed: 80,
      at: h.now,
    });
    expect(h.last('c2', 'timing')).toMatchObject({ status: 'rejected', reason: 'not_owner' });
  });

  it('ends the race when every car has retired', () => {
    const { h } = inPhase('racing');
    for (const seat of [0, 2, 3]) h.send('c1', { type: 'retire', seat });
    h.send('c2', { type: 'retire', seat: 1 });
    expect(h.state.phase).toBe('results');
  });
});

describe('leaving, reconnecting and host migration', () => {
  it('migrates the host mid-race to the longest-connected human with the AI and its last state', () => {
    const h = new Harness();
    h.join('c1', 'Ana');
    h.now += 10;
    h.join('c2', 'Ben');
    h.now += 10;
    h.join('c3', 'Cy');
    for (const c of ['c1', 'c2', 'c3']) h.send(c, ready());
    h.runUntil(h.now + 5000);
    for (const c of ['c1', 'c2', 'c3']) h.send(c, { type: 'loaded' });
    h.runUntil(h.state.start!.lightsOutAt);
    h.heartbeat(['c1', 'c2', 'c3'], (seat) => ({ x: seat * 10, lap: 0, s: seat }));
    h.clear();
    h.send('c1', { type: 'leave' });
    const host = h.last('c3', 'host')!;
    expect(host.member).toBe('m2');
    expect(host.ai.map((a) => [a.seat, a.aiIndex, a.state])).toEqual([
      [3, 0, 'racing'],
      [4, 1, 'racing'],
    ]);
    expect(host.ai[0]!.car).toMatchObject({ seat: 3, x: 30 });
    expect(h.state.cars!.find((c) => c.seat === 0)!.state).toBe('dnf');
    // The new host may now send AI cars.
    h.clear();
    h.snap('c2', [car(3, { tick: 99_999 })]);
    expect(h.relayed('c3').map((c) => c.seat)).toEqual([3]);
  });

  it('migrates the host when it disconnects, and it comes back as a guest', () => {
    const { h } = inPhase('racing');
    const token = h.memberOf('c1')!.token;
    h.close('c1');
    expect(h.state.host).toBe('m2');
    const w = h.join('c1b', 'Ana', token);
    expect(w).toMatchObject({ you: 'm1', seat: 0, room: { host: 'm2' } });
  });

  it('lets a member resume the same seat within the grace period, with its car state', () => {
    const { h } = inPhase('racing');
    h.snap('c2', [car(1, { tick: 77_777, x: 42 })]);
    const token = h.memberOf('c2')!.token;
    h.close('c2');
    expect(h.memberOf('c1') && h.state.members.find((m) => m.id === 'm2')!.status).toBe('away');
    h.now += h.machine.timings.graceMs - 1;
    const w = h.join('c2b', 'Ben', token);
    expect(w).toMatchObject({ you: 'm2', seat: 1, progress: { lap: 0, raceMs: 0 } });
    expect(w.car).toMatchObject({ seat: 1, x: 42 });
    expect(h.state.members.find((m) => m.id === 'm2')).toMatchObject({
      status: 'active',
      conn: 'c2b',
    });
  });

  it('rejects a crossing that happened while disconnected', () => {
    const { h } = inPhase('racing');
    const token = h.memberOf('c2')!.token;
    const lightsOut = h.state.start!.lightsOutAt;
    h.now = lightsOut + 5000;
    h.close('c2');
    h.now = lightsOut + 9000;
    h.join('c2b', 'Ben', token);
    h.snap('c2b', [car(1, { tick: 99_999, lap: 1, s: 5 })]);
    h.send('c2b', {
      type: 'lap',
      seat: 1,
      lap: 1,
      lapMs: 7100,
      raceMs: 7100,
      tick: 1,
      s: 1,
      speed: 80,
      at: lightsOut + 7100,
    });
    expect(h.last('c2b', 'timing')).toMatchObject({
      status: 'rejected',
      reason: 'crossed_while_disconnected',
    });
  });

  it('refuses a resume after the grace period and retires the car', () => {
    const { h } = inPhase('racing');
    const token = h.memberOf('c2')!.token;
    h.close('c2');
    h.runUntil(h.now + h.machine.timings.graceMs);
    expect(h.state.cars!.find((c) => c.seat === 1)!.state).toBe('dnf');
    h.open('c2b');
    h.send('c2b', { type: 'join', v: PROTOCOL_VERSION, name: 'Ben', resume: token });
    expect(h.last('c2b', 'error')).toMatchObject({ code: 'resume_expired' });
    expect(h.box('c2b').closed).toMatchObject({ code: CLOSE.resumeExpired });
  });

  it('replaces the old socket when a member resumes on a new one', () => {
    const { h } = inPhase('lobby');
    const token = h.memberOf('c2')!.token;
    h.join('c2b', 'Ben', token);
    expect(h.box('c2').closed).toMatchObject({ code: CLOSE.replaced });
    expect(h.state.members).toHaveLength(2);
  });

  it('turns a car into AI when its driver leaves before the start', () => {
    const { h } = inPhase('formation');
    h.clear();
    h.send('c2', { type: 'leave' });
    const car1 = h.state.cars!.find((c) => c.seat === 1)!;
    expect(car1).toMatchObject({ kind: 'ai', member: null, aiIndex: 2 });
    expect(h.last('c1', 'host')!.ai.map((a) => a.seat)).toEqual([1, 2, 3]);
  });

  it('lets the host kick, and the kicked member cannot resume', () => {
    const { h } = inPhase('lobby');
    const token = h.memberOf('c2')!.token;
    h.send('c2', { type: 'kick', member: 'm1' });
    expect(h.last('c2', 'error')).toMatchObject({ code: 'not_host' });
    h.send('c1', { type: 'kick', member: 'm9' });
    expect(h.last('c1', 'error')).toMatchObject({ code: 'no_such_member' });
    h.send('c1', { type: 'kick', member: 'm2' });
    expect(h.last('c2', 'error')).toMatchObject({ code: 'kicked' });
    expect(h.box('c2').closed).toMatchObject({ code: CLOSE.kicked });
    h.open('c2b');
    h.send('c2b', { type: 'join', v: PROTOCOL_VERSION, name: 'Ben', resume: token });
    expect(h.last('c2b', 'error')).toMatchObject({ code: 'kicked' });
  });

  it('closes the room after the last human leaves and the linger passes', () => {
    const { h } = inPhase('lobby');
    h.send('c1', { type: 'leave' });
    h.send('c2', { type: 'leave' });
    h.runUntil(h.now + h.machine.timings.roomLingerMs - 1);
    expect(h.state.phase).toBe('lobby');
    h.runUntil(h.now + 1);
    expect(h.machine.closed).toBe(true);
    expect(h.machine.nextWakeAt()).toBeNull();
  });

  it('closes a room nobody joins', () => {
    const h = new Harness();
    h.runUntil(T0 + h.machine.timings.emptyRoomTtlMs);
    expect(h.machine.closed).toBe(true);
  });

  it('refuses a new member during a race but accepts one at the results', () => {
    const { h } = inPhase('racing');
    h.open('c9');
    h.send('c9', { type: 'join', v: PROTOCOL_VERSION, name: 'Late' });
    expect(h.last('c9', 'error')).toMatchObject({ code: 'race_in_progress' });
    const r = inPhase('results').h;
    expect(r.join('c9', 'Late')).toMatchObject({ seat: 2 });
  });
});

describe('abuse limits', () => {
  it('closes a socket after too many invalid messages', () => {
    const h = new Harness();
    h.join('c1', 'Ana');
    for (let i = 0; i < LIMITS.maxStrikes; i++) h.raw('c1', '{nope');
    expect(h.last('c1', 'error')).toMatchObject({ code: 'too_many_strikes' });
    expect(h.box('c1').closed).toMatchObject({ code: CLOSE.tooManyStrikes });
  });

  it('forgives strikes over time', () => {
    const h = new Harness();
    h.join('c1', 'Ana');
    for (let i = 0; i < 30; i++) {
      h.raw('c1', '{nope');
      h.now += LIMITS.strikeDecayMs;
    }
    expect(h.box('c1').closed).toBeNull();
  });

  it('rate-limits control messages with one error a second', () => {
    const h = new Harness();
    h.join('c1', 'Ana');
    h.clear();
    for (let i = 0; i < LIMITS.control.capacity + 5; i++) h.send('c1', ready(i % 2 === 0));
    expect(h.all('c1', 'error')).toEqual([
      { type: 'error', code: 'rate_limited', detail: 'too many control messages' },
    ]);
  });

  it('rate-limits snapshot frames', () => {
    const { h } = inPhase('racing');
    h.now += 1500; // let the bucket refill
    h.clear();
    for (let i = 0; i < LIMITS.snapshot.capacity + 3; i++)
      h.snap('c2', [car(1, { tick: 50_000 + i })]);
    expect(h.relayed('c1')).toHaveLength(LIMITS.snapshot.capacity);
    expect(h.last('c2', 'error')).toMatchObject({ code: 'rate_limited' });
  });

  it('answers pings with the server time', () => {
    const h = new Harness();
    h.join('c1', 'Ana');
    h.now += 5;
    h.send('c1', { type: 'ping', id: 9, t: 123.25 });
    expect(h.last('c1', 'pong')).toEqual({ type: 'pong', id: 9, t: 123.25, now: h.now });
  });
});

describe('persistence', () => {
  it('restores from its plain state to the same room', () => {
    const { h } = inPhase('results');
    const json = JSON.parse(JSON.stringify(h.state));
    const restored = RoomMachine.restore(json, { randomInt: () => 0, token: () => 'b'.repeat(32) });
    expect(restored.view()).toEqual(h.machine.view());
    expect(restored.state).toEqual(h.state);
  });

  it('marks state dirty for control events but not for relayed snapshots', () => {
    const { h } = inPhase('racing');
    h.machine.takeDirty();
    h.snap('c2', [car(1, { tick: 123_456 })]);
    expect(h.machine.takeDirty()).toBe(false);
    h.send('c2', { type: 'limits', seat: 1, lap: 1 });
    expect(h.machine.takeDirty()).toBe(true);
  });
});

// ---- Phase x event table ---------------------------------------------------------

const SAMPLE: Record<ClientMessage['type'], (h: Harness) => Record<string, unknown>> = {
  join: () => ({ type: 'join', v: PROTOCOL_VERSION, name: 'Again' }),
  ping: () => ({ type: 'ping', id: 1, t: 0 }),
  ready: () => ready(),
  settings: () => ({ type: 'settings', patch: { laps: 4 } }),
  kick: () => ({ type: 'kick', member: 'm2' }),
  loaded: () => ({ type: 'loaded' }),
  lap: (h) => ({
    type: 'lap',
    seat: 0,
    lap: 1,
    lapMs: 7000,
    raceMs: 7000,
    tick: 1,
    s: 1,
    speed: 80,
    at: h.now,
  }),
  limits: () => ({ type: 'limits', seat: 0, lap: 1 }),
  jump_start: () => ({ type: 'jump_start', seat: 0 }),
  pit: (h) => ({ type: 'pit', seat: 0, event: 'entry', lap: 0, at: h.now }),
  retire: () => ({ type: 'retire', seat: 0 }),
  rematch: () => ({ type: 'rematch' }),
  leave: () => ({ type: 'leave' }),
};

describe('phase x message table', () => {
  const live = PHASES.filter((p) => p !== 'closed');
  const cases = live.flatMap((phase) =>
    (Object.keys(SAMPLE) as ClientMessage['type'][]).map((type) => [phase, type] as const),
  );

  it.each(cases)('%s: %s', (phase, type) => {
    const { h } = inPhase(phase);
    h.clear();
    const before = h.state.phase;
    expect(() => h.send('c1', SAMPLE[type](h))).not.toThrow();
    const wrongPhase = h.all('c1', 'error').some((e) => e.code === 'wrong_phase');
    const accepted =
      type === 'join' || type === 'ping' || type === 'leave' || PHASE_ACCEPTS[phase].has(type);
    expect(wrongPhase).toBe(!accepted);
    if (!accepted) expect(h.state.phase).toBe(before);
    // Whatever happened, the room is still consistent: the host is a member (or none).
    if (h.state.host !== null)
      expect(h.state.members.some((m) => m.id === h.state.host)).toBe(true);
  });

  it.each(live)('%s: socket close, tick and a binary frame never throw', (phase) => {
    const { h } = inPhase(phase);
    expect(() => {
      h.binary('c2', encodeUpFrame([car(1, { tick: 1e6 })], h.state.epoch));
      h.binary('c2', new Uint8Array([0xff]));
      h.close('c2');
      h.advance(10_000);
      h.advance(120_000);
    }).not.toThrow();
  });

  it('a closed room answers nothing and refuses new sockets', () => {
    const { h } = inPhase('closed');
    expect(h.machine.closed).toBe(true);
    const out = h.open('c5');
    expect(out).toEqual([
      { kind: 'close', to: 'c5', code: CLOSE.roomClosed, reason: 'room closed' },
    ]);
    expect(h.raw('c5', '{"type":"ping","id":1,"t":0}')).toEqual([]);
  });
});

describe('review findings', () => {
  it('migrates a silent host whose own car has retired while its AI still race (finding 3)', () => {
    const { h } = inPhase('racing');
    h.send('c1', { type: 'retire', seat: 0 });
    const t = h.machine.timings;
    const from = h.now;
    // The guest keeps sending; the host's tab is hidden and sends nothing, AI included.
    for (let ms = 100; ms <= t.awayMs + 200; ms += 100) {
      h.now = from + ms;
      h.heartbeat(['c2']);
      h.advance(0);
    }
    expect(h.state.host).toBe('m2');
    const handover = h.last('c2', 'host')!;
    expect(handover.member).toBe('m2');
    expect(handover.ai.map((a) => a.seat)).toEqual([2, 3]);
  });

  it('hands over the cleared grid-line crossing even before the first counted lap', () => {
    const { h } = inPhase('grid');
    const length = h.state.settings.circuit.lengthM;
    h.snap('c1', [car(2, { tick: 100, s: length - 20, lap: 0 })]);
    h.snap('c1', [car(2, { tick: 101, s: 10, lap: 0 })]);
    h.snap('c1', [car(2, { tick: 102, s: length - 20, lap: 0 })]);
    h.send('c1', { type: 'leave' });
    const handed = h.last('c2', 'host')!.ai.find((a) => a.seat === 2)!;
    expect(handed.behindLine).toBe(false);
    expect(handed.lap).toBe(0);
  });

  it('keeps a retired host that still sends its AI cars', () => {
    const { h } = inPhase('racing');
    h.send('c1', { type: 'retire', seat: 0 });
    const from = h.now;
    for (let ms = 100; ms <= h.machine.timings.awayMs + 2000; ms += 100) {
      h.now = from + ms;
      h.heartbeat(['c1', 'c2']);
      h.advance(0);
    }
    expect(h.state.host).toBe('m1');
    expect(h.memberOf('c1')!.status).toBe('active');
  });

  it('sends the stored results to a member who comes back during the results (finding 4)', () => {
    const { h } = inPhase('results');
    const results = h.last('c2', 'results')!;
    const token = h.memberOf('c2')!.token;
    h.close('c2');
    h.join('c2b', 'Ben', token);
    expect(h.last('c2b', 'results')).toEqual(results);
  });

  it('sends the stored results after the room is restored from storage (finding 4)', () => {
    const { h } = inPhase('results');
    const results = h.last('c2', 'results')!;
    const token = h.memberOf('c2')!.token;
    const restored = RoomMachine.restore(JSON.parse(JSON.stringify(h.state)), {
      randomInt: () => 0,
      token: () => 'c'.repeat(32),
    });
    const now = h.now + 10;
    restored.handle({ type: 'close', conn: 'c2' }, now);
    restored.handle({ type: 'open', conn: 'c2b', address: 'a' }, now);
    const out = restored.handle(
      {
        type: 'text',
        conn: 'c2b',
        data: JSON.stringify({ type: 'join', v: PROTOCOL_VERSION, name: 'Ben', resume: token }),
      },
      now,
    );
    const sent = out
      .filter((o) => o.kind === 'text' && o.to === 'c2b')
      .map((o) => JSON.parse((o as { text: string }).text));
    expect(sent.map((m) => m.type)).toEqual(['welcome', 'results', 'room']);
    expect(sent[1]).toEqual(results);
  });

  it('bounds unjoined sockets per address and per room, and does not persist them (finding 5)', () => {
    const h = new Harness();
    h.machine.takeDirty();
    const admitted = (address: string, n: number) => {
      let ok = 0;
      for (let i = 0; i < n; i++) {
        const conn = `${address}-${i}`;
        if (h.machine.admit(address, h.now).ok) {
          h.open(conn, address);
          if (h.box(conn).closed === null) ok++;
        }
      }
      return ok;
    };
    expect(admitted('a', 20)).toBe(LIMITS.pendingPerAddress);
    expect(h.machine.takeDirty()).toBe(false);
    let total = LIMITS.pendingPerAddress;
    for (let i = 0; i < 10; i++) total += admitted(`b${i}`, LIMITS.pendingPerAddress);
    expect(total).toBe(LIMITS.pendingPerRoom);
    expect(h.state.conns.length).toBe(LIMITS.pendingPerRoom);
    expect(h.machine.admit('fresh', h.now)).toMatchObject({ ok: false });
    // Pending sockets time out and free their slots.
    h.runUntil(h.now + h.machine.timings.joinTimeoutMs);
    expect(h.state.conns.length).toBe(0);
    expect(h.machine.admit('fresh', h.now)).toEqual({ ok: true });
  });

  it('closes a socket opened past the limits even if the shell did not ask first', () => {
    const h = new Harness();
    for (let i = 0; i < 1000; i++) h.open(`x${i}`, `addr${i}`);
    expect(h.state.conns.length).toBeLessThanOrEqual(LIMITS.pendingPerRoom);
    expect(h.box('x999').closed).toMatchObject({ code: CLOSE.busy });
  });

  it('throttles how fast a room admits sockets', () => {
    const h = new Harness();
    let refused = 0;
    for (let i = 0; i < 200; i++) {
      const r = h.machine.admit(`addr${i}`, h.now);
      if (!r.ok) refused++;
      else {
        h.open(`x${i}`, `addr${i}`);
        h.close(`x${i}`);
      }
    }
    expect(refused).toBeGreaterThan(0);
    expect(200 - refused).toBeLessThanOrEqual(LIMITS.admission.capacity);
  });
});

describe('admission', () => {
  it('never swallows what a due deadline would send (admit does not run the clock)', () => {
    const { h } = inPhase('formation');
    const start = h.state.start!;
    h.clear();
    // The first light is due; a socket asks to connect before any tick ran.
    expect(h.machine.admit('late', start.lightsStartAt + 1)).toEqual({ ok: true });
    h.now = start.lightsStartAt + 1;
    h.open('c9', 'late');
    expect(h.state.phase).toBe('lights');
    expect(h.all('c1', 'room').some((r) => r.room.phase === 'lights')).toBe(true);
  });
});

describe('persistence policy', () => {
  it.each([
    ['lobby', true],
    ['grid', false],
    ['formation', false],
    ['lights', false],
    ['racing', false],
    ['finished', false],
    ['results', true],
  ] as const)('%s: state writes must be confirmed before messages go out: %s', (phase, durable) => {
    // While cars are on track, holding every relay until a write is durable would
    // stall snapshots behind the disk; persistence is only promised in lobby and results.
    expect(inPhase(phase).h.machine.durableWrites).toBe(durable);
  });
});

describe('room lifetime cap', () => {
  const HOUR = 3600_000;

  it('has no cap by default', () => {
    const h = new Harness();
    h.join('c1', 'Ana');
    expect(h.machine.timings.maxRoomAgeMs).toBe(Number.POSITIVE_INFINITY);
    expect(h.machine.nextWakeAt()).toBeNull();
  });

  it('closes a lobby at the cap even with members connected', () => {
    const h = new Harness({ maxRoomAgeMs: 6 * HOUR });
    h.join('c1', 'Ana');
    h.join('c2', 'Ben');
    expect(h.machine.nextWakeAt()).toBe(T0 + 6 * HOUR);
    h.runUntil(T0 + 6 * HOUR - 1);
    expect(h.state.phase).toBe('lobby');
    h.runUntil(T0 + 6 * HOUR);
    expect(h.machine.closed).toBe(true);
    expect(h.last('c1', 'error')).toMatchObject({ code: 'room_closed' });
    expect(h.box('c1').closed).toMatchObject({ code: CLOSE.roomClosed });
    expect(h.box('c2').closed).toMatchObject({ code: CLOSE.roomClosed });
    expect(h.machine.nextWakeAt()).toBeNull();
  });

  it('lets a race that runs past the cap finish, then closes after the results', () => {
    const h = new Harness({ maxRoomAgeMs: 60_000 });
    h.runUntil(T0 + 50_000);
    const conns = h.toRacing();
    for (let i = 0; i < 100; i++) {
      h.now += 400;
      h.heartbeat(conns);
      h.advance(0);
    }
    expect(h.now).toBeGreaterThan(T0 + 60_000);
    expect(h.state.phase).toBe('racing');
    driveLaps(h, conns, 3);
    expect(h.state.phase).toBe('results');
    h.runUntil(h.now + h.machine.timings.resultsLingerMs - 1);
    expect(h.state.phase).toBe('results');
    h.runUntil(h.now + 1);
    expect(h.machine.closed).toBe(true);
    expect(h.box('c1').closed).toMatchObject({ code: CLOSE.roomClosed });
  });

  it('closes on a rematch after the cap instead of opening a new lobby', () => {
    const h = new Harness({ maxRoomAgeMs: 60_000 });
    h.runUntil(T0 + 50_000);
    const conns = h.toRacing();
    driveLaps(h, conns, 3);
    expect(h.state.phase).toBe('results');
    h.runUntil(Math.max(h.now, T0 + 60_000));
    expect(h.state.phase).toBe('results');
    h.send('c1', { type: 'rematch' });
    expect(h.machine.closed).toBe(true);
  });
});
