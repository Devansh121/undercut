import { describe, it } from 'vitest';
import { expectQuickRace } from './lib/expect-race';
import { quickRaceProof } from './lib/quick-race-proof';
import { runRace } from './lib/runner';

quickRaceProof('spa', [2]);

describe('Quick Race at Spa, lap one: starts that once went wrong', () => {
  // 103: two cars level into La Source each gave way to the other and followed each other to a
  // standstill; the field queued behind them for 6 s. 116: two pairs touching into La Source,
  // 16 of 20 clean.
  for (const seed of [103, 116, 118]) {
    it(`seed ${seed}: clean start, every car classified, no stuck cars, no spins`, () => {
      expectQuickRace(runRace({ circuit: 'spa', cars: 20, laps: 1, seed, pitLap: null }), 1);
    }, 180_000);
  }
});
