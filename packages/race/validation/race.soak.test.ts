import { describe, expect, it } from 'vitest';
import { runRace, runWeekend } from './lib/runner';
import { expectCleanRace, expectQuickRace } from './lib/expect-race';

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

describe('Quick Race on more seeds, with pit stops', () => {
  for (const seed of [2, 3, 4, 404]) {
    it(`seed ${seed}`, () => {
      expectCleanRace(runRace({ cars: 20, laps: 5, seed }), 5);
    }, 600_000);
  }
});

describe('Quick Race at Spa and Singapore on more seeds', () => {
  const MORE: Record<'spa' | 'singapore', number[]> = {
    spa: [1, 3, 17, 29, 211],
    singapore: [1, 2, 3, 29, 211],
  };
  for (const [circuit, seeds] of Object.entries(MORE) as ['spa' | 'singapore', number[]][]) {
    for (const seed of seeds) {
      it(`${circuit}, seed ${seed}`, () => {
        expectQuickRace(runRace({ circuit, cars: 20, laps: 5, seed, pitLap: null }), 5);
      }, 600_000);
    }
  }
});

describe('Quick Race clean-start sweep across 20 independent seeds', () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => 101 + i);
  for (const seed of SEEDS) {
    it(`seed ${seed}: clean start and lap one, no anomalies or barrier breaches`, () => {
      const run = runRace({ cars: 20, laps: 1, seed, pitLap: null });
      const r = run.result;
      expect(r.anomalies).toEqual([]);
      expect(r.entries.every((e) => e.status === 'finished' && e.laps === 1)).toBe(true);
      expect(run.cars.filter((c) => c.turnOne === 'clean').length).toBeGreaterThanOrEqual(18);
      expect(run.cars.every((c) => c.beyondBarrier <= 0)).toBe(true);
      expect(run.cars.every((c) => c.longestContact < 5)).toBe(true);
    }, 180_000);
  }
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
