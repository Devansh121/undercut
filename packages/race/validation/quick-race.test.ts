import { expect, it } from 'vitest';
import { runRace } from './lib/runner';

for (const seed of [1, 2, 3]) {
  it(`twenty cars survive turn one and finish five laps, seed ${seed}`, () => {
    const run = runRace({ cars: 20, laps: 5, seed, pitLap: null });
    expect(run.result.entries.every((e) => e.status === 'finished')).toBe(true);
    expect(run.result.anomalies).toEqual([]);
    expect(run.cars.filter((c) => c.turnOne === 'clean').length).toBeGreaterThanOrEqual(18);
    expect(run.cars.every((c) => c.beyondBarrier <= 0)).toBe(true);
    expect(run.cars.every((c) => c.longestContact < 5)).toBe(true);
  }, 300_000);
}

it('a twenty-car race is bit-identical when rerun', () => {
  const a = runRace({ cars: 20, laps: 1, seed: 1, pitLap: null });
  const b = runRace({ cars: 20, laps: 1, seed: 1, pitLap: null });
  expect(b.result).toEqual(a.result);
  expect(b.events).toEqual(a.events);
}, 180_000);
