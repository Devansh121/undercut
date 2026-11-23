import { describe, it } from 'vitest';
import { expectQuickRace } from './lib/expect-race';
import { quickRaceProof } from './lib/quick-race-proof';
import { runRace } from './lib/runner';

quickRaceProof('spa', [2, 211]);

describe('Quick Race at Spa, seed 103: the La Source standstill', () => {
  // Two cars level into the hairpin each gave way to the other and followed each other to a
  // standstill; the field queued behind them for 6 s.
  it('two cars level into the hairpin do not hold the field up', () => {
    expectQuickRace(runRace({ circuit: 'spa', cars: 20, laps: 1, seed: 103, pitLap: null }), 1);
  }, 180_000);
});
