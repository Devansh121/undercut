import { describe, it } from 'vitest';
import { expectQuickRace } from './lib/expect-race';
import { quickRaceProof } from './lib/quick-race-proof';
import { runRace } from './lib/runner';

quickRaceProof('singapore', [17]);

describe('Quick Race at Singapore, lap one: a start that once went wrong', () => {
  // 119: two cars level into turn 1 both gave way and braked in step side by side, the one giving
  // way steered for its line into the other, and the queue stopped: 7 of 20 clean, 3 spins.
  it('seed 119: clean start, every car classified, no stuck cars, no spins', () => {
    expectQuickRace(
      runRace({ circuit: 'singapore', cars: 20, laps: 1, seed: 119, pitLap: null }),
      1,
    );
  }, 180_000);
});
