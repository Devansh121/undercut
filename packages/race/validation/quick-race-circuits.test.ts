import { describe, expect, it } from 'vitest';
import { expectQuickRace } from './lib/expect-race';
import { runRace, type RaceCircuit } from './lib/runner';

/**
 * Quick Race at Spa and Singapore as the game runs it (physics job): twenty AI cars, five laps,
 * no stops, every car in the trim its circuit's racing line was built for (Spa medium,
 * Singapore high), pace shuffled against the grid. The nightly soak runs more seeds
 * (race.soak.test.ts); Monza's proof, with stops, is quick-race.test.ts.
 */
const SEEDS: Record<Exclude<RaceCircuit, 'monza'>, number[]> = {
  // 103 on lap one was the La Source standstill (two cars level each giving way to the other).
  spa: [2, 211],
  singapore: [17, 29],
};

for (const [circuit, seeds] of Object.entries(SEEDS) as [RaceCircuit, number[]][]) {
  describe(`Quick Race at ${circuit}: twenty cars, five laps`, () => {
    for (const seed of seeds) {
      it(`seed ${seed}: clean start, every car classified, no stuck cars, no spins`, () => {
        expectQuickRace(runRace({ circuit, cars: 20, laps: 5, seed, pitLap: null }), 5);
      }, 300_000);
    }

    it('is bit-identical when rerun', () => {
      const a = runRace({ circuit, cars: 20, laps: 1, seed: 1, pitLap: null });
      const b = runRace({ circuit, cars: 20, laps: 1, seed: 1, pitLap: null });
      expect(b.result).toEqual(a.result);
      expect(b.events).toEqual(a.events);
    }, 180_000);
  });
}

describe('Quick Race at Spa, seed 103: the La Source standstill', () => {
  it('two cars level into the hairpin do not hold the field up', () => {
    expectQuickRace(runRace({ circuit: 'spa', cars: 20, laps: 1, seed: 103, pitLap: null }), 1);
  }, 180_000);
});
