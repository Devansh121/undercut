import { describe, expect, it } from 'vitest';
import { expectCleanRace } from './lib/expect-race';
import { runRace } from './lib/runner';

/**
 * The Quick Race proof (physics job): twenty AI cars, five laps at Monza, one tyre stop each
 * around half distance, pace shuffled against the grid as qualifying would. The nightly soak
 * runs more seeds and the full distance (race.soak.test.ts).
 */
describe('Quick Race: twenty cars, five laps, pit stops', () => {
  for (const seed of [1, 17]) {
    it(`seed ${seed}: clean start, every car classified, no stuck cars, cars pass`, () => {
      expectCleanRace(runRace({ cars: 20, laps: 5, seed }), 5);
    }, 300_000);
  }

  it('a twenty-car race is bit-identical when rerun', () => {
    const a = runRace({ cars: 20, laps: 1, seed: 1, pitLap: null });
    const b = runRace({ cars: 20, laps: 1, seed: 1, pitLap: null });
    expect(b.result).toEqual(a.result);
    expect(b.events).toEqual(a.events);
  }, 180_000);
});
