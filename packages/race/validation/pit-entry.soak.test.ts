import { expect, it } from 'vitest';
import { raceStartFuel } from '../src';
import { runRace } from './lib/runner';
for (const seed of [3141, 2718]) {
  it(`twenty-car seed ${seed}: scheduled stops do not produce a high-speed pit-entry rear-end`, () => {
    const run = runRace({ cars: 20, laps: 5, seed, tyres: true, startFuel: raceStartFuel(5, 53) });
    expect(run.result.anomalies).toEqual([]);
    expect(run.result.entries.every((e) => e.status === 'finished' && e.pitStops === 1)).toBe(true);
    expect(Math.max(...run.cars.map((c) => c.maxContactSpeed))).toBeLessThan(10);
  }, 600_000);
}
