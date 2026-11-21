import { describe, expect, it } from 'vitest';
import { runRace, runWeekend } from './lib/runner';

// Nightly: twenty AI cars, race distance, and a race weekend. The product's acceptance test is a
// scripted race weekend against nineteen AI cars with no stuck cars.

describe('twenty AI cars at Monza, race distance', () => {
  it('finishes with every car classified, one stop each, no stuck cars', () => {
    const run = runRace({ cars: 20, laps: 53, seed: 1 });
    const r = run.result;
    expect(r.anomalies).toEqual([]);
    expect(r.entries.every((e) => e.status === 'finished')).toBe(true);
    expect(r.entries.every((e) => e.pitStops === 1 && e.compounds.length === 2)).toBe(true);
    expect(run.cars.filter((c) => c.turnOne === 'clean').length).toBeGreaterThanOrEqual(18);
    expect(run.cars.every((c) => c.beyondBarrier <= 0)).toBe(true);
    expect(run.cars.every((c) => c.longestContact < 5)).toBe(true);
  });
});

describe('a race weekend at Monza', () => {
  it('runs practice, qualifying and a ten-lap race with the grid from qualifying', () => {
    const { weekend, runs } = runWeekend({
      cars: 20,
      laps: 10,
      seed: 2,
      practice: 600,
      qualifying: 900,
    });
    expect(weekend.done).toBe(true);
    for (const run of runs) expect(run.result.anomalies).toEqual([]);
    const q = runs[1]!.result;
    expect(q.entries.filter((e) => e.bestLap !== null)).toHaveLength(20);
    const race = runs[2]!.result;
    expect(race.entries.every((e) => e.status === 'finished')).toBe(true);
  });
});
