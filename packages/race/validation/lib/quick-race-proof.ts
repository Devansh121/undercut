import { describe, expect, it } from 'vitest';
import { expectQuickRace } from './expect-race';
import { runRace, type RaceCircuit } from './runner';

/**
 * Quick Race at a circuit as the game runs it (physics job): twenty AI cars, five laps, no
 * stops, every car in the trim the circuit's racing line was built for (Spa medium, Singapore
 * high), pace shuffled against the grid, on `seeds`; and a rerun bit-identical. One test file
 * per circuit, so the physics job runs them side by side. The nightly soak runs more seeds
 * (race.soak.test.ts); Monza's proof, with stops, is quick-race.test.ts.
 */
export function quickRaceProof(circuit: RaceCircuit, seeds: readonly number[]): void {
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
