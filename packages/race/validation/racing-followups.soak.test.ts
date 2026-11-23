import { describe, expect, it } from 'vitest';
import { expectQuickRace } from './lib/expect-race';
import { runFollowupRace } from './lib/followup-proof';
import type { RaceRun } from './lib/runner';

const CIRCUITS = ['monza', 'spa', 'singapore'] as const;

for (const circuit of CIRCUITS) {
  describe(`Quick Race at ${circuit}, tyre and fuel start sweep`, () => {
    for (let seed = 101; seed <= 120; seed++) {
      it(`seed ${seed}: clean lap one, every car classified, no spins`, () => {
        expectQuickRace(runFollowupRace(circuit, seed), 1);
      });
    }
  });
}

const fiveLaps = new Map<string, RaceRun>();
const race = (circuit: (typeof CIRCUITS)[number]): RaceRun => {
  let run = fiveLaps.get(circuit);
  if (!run) fiveLaps.set(circuit, (run = runFollowupRace(circuit, 17, 5)));
  return run;
};

describe('five laps, seed 17', () => {
  for (const circuit of CIRCUITS) {
    it(`${circuit}: no spin or hard contact, every car classified`, () => {
      const run = race(circuit);
      expectQuickRace(run, 5);
      expect(Math.max(...run.cars.map((c) => c.maxContactSpeed))).toBeLessThan(3);
    });
    // Open gap (docs/STATUS.md): no on-track pass in a Quick Race without stops.
    it.fails(`${circuit}: a faster car passes on track`, () => {
      expect(race(circuit).racing.overtakes).toBeGreaterThan(0);
    });
  }
});
