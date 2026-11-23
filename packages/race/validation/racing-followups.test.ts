import { describe, expect, it } from 'vitest';
import { expectQuickRace } from './lib/expect-race';
import { followupGap, runFollowupRace } from './lib/followup-proof';

// Lap one of the starts recorded as AI gaps (docs/STATUS.md): lane changes into the turn-one
// braking zone (Monza 1022 and 7307), the moving-pack contact (4114380179) and Singapore 119.
// The two lane-change starts are still open gaps, held as expected failures so a fix shows.
describe('recorded lane-change and moving-pack starts', () => {
  const recorded = [
    ['monza', 1022],
    ['monza', 7307],
    ['monza', 4114380179],
    ['singapore', 119],
  ] as const;
  for (const [circuit, seed] of recorded) {
    const test = followupGap(circuit, seed, true) ? it.fails : it;
    test(`${circuit} seed ${seed}: no hard contact or spin, every car classified`, () => {
      const run = runFollowupRace(circuit, seed);
      expectQuickRace(run, 1);
      expect(Math.max(...run.cars.map((c) => c.maxContactSpeed))).toBeLessThan(3);
    }, 180_000);
  }
});
