import { describe, expect, it } from 'vitest';
import { buildResult } from '../src/results';
import { ManualRace, STEP, ofType } from './rails';

// Second review of #15: the reviewer's scenarios, written before their fixes. Rail loop:
// 1000 m, timing line at s = 950, grid slot 0 at +40 m, slot 1 at +32 m.

const entrants = Array.from({ length: 2 }, (_, i) => ({
  id: `d${i}`,
  name: `Driver ${i}`,
  code: `D${i}`,
  team: i,
}));

describe('a close finish (second review)', () => {
  it('settles an off-track pass when both cars finish in the same tick', () => {
    const r = new ManualRace({ kind: 'race', laps: 1 }, 2);
    r.toGreen();
    const end = r.tickEndAfter(19.2);
    const start = end - STEP;
    // Car 1 gains the place over the last second with all four wheels off, and takes the flag
    // 1 ms before car 0, in the same tick.
    const at0 = end - 0.001;
    const at1 = end - 0.002;
    r.dist[0] = (u) => 40 + (960 * u) / at0;
    const b = 32 + 50 * (start - 1);
    r.dist[1] = (u) =>
      u < start - 1 ? 32 + 50 * u : b + ((1000 - b) * (u - (start - 1))) / (at1 - (start - 1));
    r.wheelsOff[1] = (u) => (u > start - 1 ? 4 : 0);
    r.run(30, () => r.control.ended);
    expect(
      ofType(r.log, 'penalty')
        .filter((e) => e.reason === 'leavingTrack')
        .map((e) => e.car),
    ).toEqual([1]);
    expect(buildResult(r.control, entrants, 1).entries.map((e) => e.car)).toEqual([0, 1]);
  });

  it('keeps the established order for a complete tie at the finish in the final results', () => {
    const r = new ManualRace({ kind: 'race', laps: 1 }, 2);
    r.toGreen();
    const at = r.tickEndAfter(20);
    const start = at - STEP;
    // Both cross the line at exactly the same interpolated time; car 1 was ahead before.
    r.dist[0] = (u) => (u < start ? 40 + ((999 - 40) * u) / start : 999 + (u - start) / STEP);
    r.dist[1] = (u) =>
      u < start ? 32 + ((999.5 - 32) * u) / start : 999.5 + (0.5 * (u - start)) / STEP;
    r.run(30, () => r.control.ended);
    const c = r.control.cars;
    expect(c[0]!.finishTime).toBe(c[1]!.finishTime);
    expect(r.control.order).toEqual([1, 0]);
    const res = buildResult(r.control, entrants, 1);
    expect(res.entries.map((e) => e.car)).toEqual([1, 0]);
    expect(res.entries.map((e) => e.points)).toEqual([25, 18]);
  });
});
