/**
 * The timing referee against the server-owned race clock, and the chequered flag's
 * independence from the order crossing claims arrive in.
 */
import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import type { LapMessage } from '../src/index';
import { Harness, car } from './harness';

/** Two humans (seats 0, 1) and two host AI (seats 2, 3), racing. Host is c1. */
function racing(): { h: Harness; out: number } {
  const h = new Harness();
  h.join('c1', 'Ana');
  h.join('c2', 'Ben');
  h.send('c1', { type: 'ready', ready: true });
  h.send('c2', { type: 'ready', ready: true });
  h.runUntil(h.now + h.machine.timings.readyCountdownMs);
  h.send('c1', { type: 'loaded' });
  h.send('c2', { type: 'loaded' });
  const out = h.state.start!.lightsOutAt;
  h.runUntil(out);
  expect(h.state.phase).toBe('racing');
  return { h, out };
}

const OWNER: Record<number, string> = { 0: 'c1', 1: 'c2', 2: 'c1', 3: 'c1' };

function claim(seat: number, lap: number, raceMs: number, lapMs: number, out: number): LapMessage {
  return { type: 'lap', seat, lap, lapMs, raceMs, tick: lap, s: 1, speed: 80, at: out + raceMs };
}

describe('race times are checked against the server-owned start', () => {
  it('rejects a three-lap finish claimed 39 ms after lights out (review finding 1)', () => {
    const { h, out } = racing();
    h.now = out + 39;
    // The cheat also sends a snapshot that agrees with its claim.
    h.snap('c2', [car(1, { tick: 50_000, lap: 3, s: 1, t: h.now })]);
    for (let lap = 1; lap <= 3; lap++) {
      const raceMs = lap * 5000;
      h.send('c2', { ...claim(1, lap, raceMs, 5000, out), at: h.now });
    }
    const verdicts = h.all('c2', 'timing').map((t) => [t.lap, t.status, t.reason]);
    expect(verdicts).toEqual([
      [1, 'rejected', 'ahead_of_race_clock'],
      [2, 'rejected', 'ahead_of_race_clock'],
      [3, 'rejected', 'ahead_of_race_clock'],
    ]);
    expect(h.state.phase).toBe('racing');
    expect(h.state.cars!.find((c) => c.seat === 1)!.lap).toBe(0);
  });

  it('rejects a claimed crossing time that disagrees with its own race time', () => {
    const { h, out } = racing();
    h.now = out + 20_000;
    // Race time 7 s but "crossed" at 19.9 s after lights out.
    h.send('c2', { ...claim(1, 1, 7000, 7000, out), at: out + 19_900 });
    expect(h.last('c2', 'timing')).toMatchObject({
      status: 'rejected',
      reason: 'timestamp_implausible',
    });
  });

  it('allows a race time slightly ahead of the server clock (clock-sync error)', () => {
    const { h, out } = racing();
    h.now = out + 7000 - 300;
    h.send('c2', claim(1, 1, 7000, 7000, out));
    expect(h.last('c2', 'timing')!.status).not.toBe('rejected');
  });
});

describe('the chequered flag', () => {
  it('re-evaluates every car when a late, earlier finish moves the flag (review finding 2)', () => {
    const { h, out } = racing();
    const send = (seat: number, lap: number, raceMs: number, lapMs: number, arriveAt: number) => {
      h.now = Math.max(h.now, out + arriveAt);
      h.send(OWNER[seat]!, claim(seat, lap, raceMs, lapMs, out));
    };
    send(2, 1, 5000, 5000, 5000); // C, laps of 5 s
    send(0, 1, 7000, 7000, 7000); // A, laps of 7 s
    send(1, 1, 9000, 9000, 9000); // B, laps of 9 s
    send(2, 2, 10_000, 5000, 10_000);
    send(0, 2, 14_000, 7000, 14_000);
    send(1, 2, 18_000, 9000, 18_000); // B crosses at 18 s
    send(0, 3, 21_000, 7000, 21_000); // A's finish arrives first: flag at 21 s
    expect(h.state.chequerRaceMs).toBe(21_000);
    send(2, 3, 15_000, 5000, 21_100); // C's earlier finish (15 s) arrives late
    expect(h.state.chequerRaceMs).toBe(15_000);
    // B crossed at 18 s, after the 15 s flag: that was its finish.
    expect(h.state.cars!.find((c) => c.seat === 1)).toMatchObject({
      state: 'finished',
      lap: 2,
      raceMs: 18_000,
    });
    // A's third lap came after its own flag crossing at 21 s... A crossed 14 s (<15) then 21 s (>=15).
    expect(h.state.cars!.find((c) => c.seat === 0)).toMatchObject({
      state: 'finished',
      lap: 3,
      raceMs: 21_000,
    });
  });

  it('cuts laps counted after a car took the flag when the flag moves earlier', () => {
    const { h, out } = racing();
    const send = (seat: number, lap: number, raceMs: number, lapMs: number, arriveAt: number) => {
      h.now = Math.max(h.now, out + arriveAt);
      h.send(OWNER[seat]!, claim(seat, lap, raceMs, lapMs, out));
    };
    send(1, 1, 6000, 6000, 6000);
    send(1, 2, 12_000, 6000, 12_000);
    send(0, 1, 5100, 5100, 12_100);
    send(0, 2, 10_200, 5100, 12_200);
    send(1, 3, 18_000, 6000, 18_000); // B finishes: flag 18 s
    send(2, 1, 5000, 5000, 18_100);
    send(2, 2, 10_000, 5000, 18_200);
    send(0, 3, 15_300, 5100, 18_300); // A finished earlier, at 15.3 s: flag 15.3 s
    // B's 18 s crossing is still its finish (first at or after 15.3 s), on lap 3.
    expect(h.state.cars!.find((c) => c.seat === 1)).toMatchObject({ state: 'finished', lap: 3 });
    send(2, 3, 15_000, 5000, 18_400); // C finished even earlier, at 15.0 s
    expect(h.state.chequerRaceMs).toBe(15_000);
    // Now A's flag crossing is 15.3 s (lap 3) and B's first crossing at or after 15 s is 18 s.
    expect(h.state.cars!.map((c) => [c.seat, c.state, c.lap])).toEqual(
      expect.arrayContaining([
        [0, 'finished', 3],
        [1, 'finished', 3],
        [2, 'finished', 3],
      ]),
    );
  });

  it('gives the same classification for any arrival order of the same crossings (property)', () => {
    const rng = createRng(4242);
    let checked = 0;
    for (let trial = 0; trial < 300; trial++) {
      // Each car laps at its own pace; drivers keep crossing until told they finished,
      // so every car reports up to two laps past the distance.
      const crossings: { seat: number; lap: number; raceMs: number; lapMs: number }[] = [];
      // Two fast cars on different sockets finish within the arrival spread of each
      // other, and two slower ones cross for the second time around then: the case
      // where the order of arrival decides who has already taken the flag.
      const pace: Record<number, number> = {
        0: rng.int(5000, 5600),
        1: rng.int(5000, 5600),
        2: rng.int(7300, 8300),
        3: rng.int(7300, 8300),
      };
      for (const seat of [0, 1, 2, 3]) {
        const lapMs = pace[seat]!;
        for (let lap = 1; lap <= 5; lap++)
          crossings.push({ seat, lap, raceMs: lap * lapMs, lapMs });
      }
      let reference: string | null = null;
      for (let order = 0; order < 4; order++) {
        const { h, out } = racing();
        // Per socket the order is fixed (one TCP stream); across sockets arrival is
        // delayed independently by up to 1.9 s (under the 2 s time-mismatch tolerance, so
        // flags do not depend on the order either).
        const bySocket = new Map<string, { at: number; c: (typeof crossings)[number] }[]>();
        for (const c of crossings) {
          const sock = OWNER[c.seat]!;
          const list = bySocket.get(sock) ?? [];
          list.push({ at: c.raceMs, c });
          bySocket.set(sock, list);
        }
        const arrivals: { arrive: number; sock: string; c: (typeof crossings)[number] }[] = [];
        for (const [sock, list] of bySocket) {
          list.sort((a, b) => a.at - b.at || a.c.seat - b.c.seat);
          let last = 0;
          for (const { at, c } of list) {
            last = Math.max(last, at + rng.int(0, 1900));
            arrivals.push({ arrive: last, sock, c });
          }
        }
        arrivals.sort((a, b) => a.arrive - b.arrive);
        for (const a of arrivals) {
          h.now = Math.max(h.now, out + a.arrive);
          h.advance(0);
          if (h.state.phase !== 'racing' && h.state.phase !== 'finished') break;
          h.send(a.sock, claim(a.c.seat, a.c.lap, a.c.raceMs, a.c.lapMs, out));
        }
        expect(h.state.phase).toBe('results');
        const rows = JSON.stringify(h.last('c2', 'results')!.results.rows);
        if (reference === null) reference = rows;
        else expect(rows).toBe(reference);
        checked++;
      }
    }
    expect(checked).toBe(1200);
  });
});
