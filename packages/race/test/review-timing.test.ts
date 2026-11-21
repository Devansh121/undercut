import { describe, expect, it } from 'vitest';
import { ManualRace, STEP, ofType } from './rails';

// Regression tests for the adversarial review of PR #15: each scenario is the reviewer's,
// written before its fix. Rail loop: 1000 m, timing line at s = 950, grid slot 0 at +40 m,
// slot 1 at +32 m (race distance from the timing line).

/** Constant speed from `start`, reaching `target` exactly `at` s after lights out. */
const through = (start: number, target: number, at: number) => (u: number) =>
  start + ((target - start) / at) * u;

describe('chequered flag, by time not by car number (review 3)', () => {
  it('a lapped car with the lower number crossing 1 ms after the winner finishes', () => {
    const r = new ManualRace({ kind: 'race', laps: 3 }, 2);
    r.toGreen();
    const at = r.tickEndAfter(29.5) - 0.002;
    r.dist[1] = through(32, 3000, at); // winner, car 1
    r.dist[0] = through(40, 2000, at + 0.001); // a lap down, car 0, 1 ms later in the same tick
    r.run(40, () => r.control.cars[1]!.finishTime !== null);
    expect(r.control.cars[1]!.finishTime).toBeCloseTo((r.control.lightsOutAt ?? 0) + at, 9);
    expect(r.control.cars[0]).toMatchObject({ status: 'finished', finishLaps: 2 });
  });

  it('a lapped car with the higher number crossing 1 ms before the winner does not finish', () => {
    const r = new ManualRace({ kind: 'race', laps: 3 }, 2);
    r.toGreen();
    const at = r.tickEndAfter(29.5) - 0.001;
    r.dist[0] = through(40, 3000, at); // winner, car 0
    r.dist[1] = through(32, 2000, at - 0.001); // a lap down, car 1, 1 ms earlier in the same tick
    r.run(40, () => r.control.cars[0]!.finishTime !== null);
    expect(r.control.cars[0]!.status).toBe('finished');
    expect(r.control.cars[1]!.status).toBe('running');
    expect(r.control.cars[1]!.finishTime).toBeNull();
  });
});

describe('finish distance (review 4)', () => {
  it('freezes at the line, not at the end of the tick', () => {
    const r = new ManualRace({ kind: 'race', laps: 1 }, 1);
    r.toGreen();
    r.dist[0] = (u) => 40 + 51 * u;
    r.run(40, () => r.control.ended);
    expect(r.control.cars[0]!.finishDist).toBe(1000);
  });

  it('orders cars that finish in the same tick by finish time, whatever their speed', () => {
    const r = new ManualRace({ kind: 'race', laps: 1 }, 2);
    r.toGreen();
    // Both at constant speed through the last tick (the interpolation assumes it): car 0 crosses
    // 3.0 ms before the tick ends at 50 m/s, car 1 2.9 ms before it at 400 m/s, so car 1 is far
    // ahead at the end of the tick although it crossed second.
    const end = r.tickEndAfter(15);
    const start = end - STEP;
    const p1 = 1000 - 400 * (STEP - 0.0029);
    r.dist[0] = through(40, 1000, end - 0.003);
    r.dist[1] = (u) => (u < start ? through(32, p1, start)(u) : p1 + 400 * (u - start));
    r.run(40, () => r.control.cars[1]!.finishTime !== null);
    const c = r.control.cars;
    expect(c[0]!.finishTime!).toBeLessThan(c[1]!.finishTime!);
    expect(r.control.order).toEqual([0, 1]);
    expect(c[0]!.position).toBe(1);
  });
});

describe('DRS detection, by time not by car number (review 7)', () => {
  it('two cars crossing detection in one tick: the trailing car is eligible, the leader gets no negative gap', () => {
    const r = new ManualRace({ kind: 'race', laps: 5 }, 2);
    r.toGreen();
    // Laps from the leader's lap 3: detection at s 780 is 830 m into each lap.
    const det = 2 * 1000 + 830;
    const at = r.tickEndAfter((2 * 1000) / 50 + 20) - 0.003;
    r.dist[1] = through(32, det, at); // leader, car 1
    r.dist[0] = through(40, det - 1000 * 0, at + 0.0005); // trailing 0.5 ms, car 0
    // Keep them going after detection at the same speeds.
    const v1 = (det - 32) / at;
    const v0 = (det - 40) / (at + 0.0005);
    const d1 = r.dist[1]!;
    const d0 = r.dist[0]!;
    r.dist[1] = (u) => (u <= at + 1 ? d1(u) : d1(at + 1) + v1 * (u - at - 1));
    r.dist[0] = (u) => (u <= at + 1 ? d0(u) : d0(at + 1) + v0 * (u - at - 1));
    r.run(80, () => r.control.time - r.control.lightsOutAt! > at + 0.5);
    const el = ofType(r.log, 'drsEligible').filter((e) => e.t - r.control.lightsOutAt! > at - 0.01);
    expect(el.map((e) => e.car)).toEqual([0]);
    expect(el[0]!.gap).toBeGreaterThanOrEqual(0);
    expect(el[0]!.gap).toBeCloseTo(0.0005, 6);
    expect(ofType(r.log, 'drsEligible').every((e) => e.gap >= 0)).toBe(true);
  });
});
