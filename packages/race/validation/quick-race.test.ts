import { describe, expect, it } from 'vitest';
import { expectCleanRace } from './lib/expect-race';
import { runRace } from './lib/runner';

/**
 * The Quick Race proof (physics job): twenty AI cars, five laps at Monza, one tyre stop each
 * around half distance, pace shuffled against the grid as qualifying would. The nightly soak
 * runs more seeds and the full distance (race.soak.test.ts).
 */
describe('Quick Race: twenty cars, five laps, pit stops', () => {
  // 17: the pit-stop deadlock of the first review; 29 and 211: lap-1 contacts into the first
  // chicane of the second.
  for (const seed of [17, 29, 211]) {
    it(`seed ${seed}: clean start, every car classified, no stuck cars, cars pass`, () => {
      const run = runRace({ cars: 20, laps: 5, seed });
      expectCleanRace(run, 5);
      // 211: a 10.8 m/s contact at the first chicane's exit on lap 5, two cars converging on
      // the line as one came back from a pass before their bodies were clear.
      if (seed === 211) expect(Math.max(...run.cars.map((c) => c.maxContactSpeed))).toBeLessThan(8);
    }, 300_000);
  }

  it('a twenty-car race is bit-identical when rerun', () => {
    const a = runRace({ cars: 20, laps: 1, seed: 1, pitLap: null });
    const b = runRace({ cars: 20, laps: 1, seed: 1, pitLap: null });
    expect(b.result).toEqual(a.result);
    expect(b.events).toEqual(a.events);
  }, 180_000);
});
