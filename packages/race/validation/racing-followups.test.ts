import { describe, expect, it } from 'vitest';
import { expectQuickRace } from './lib/expect-race';
import { followupGap, runFollowupRace } from './lib/followup-proof';

// Lap one under the Quick Race proof settings (20 cars, tyres, five-lap start fuel, no stops).
// Monza 1022 and 7307 reproduce lane changes into the turn-one braking zone and are
// ordinary regression tests. Monza 4114380179 and
// Singapore 119 are regression guards only: under these settings they read 20 of 20 on master
// too, and do not reproduce the phone reports (a 22.4 m/s moving-pack contact; 7 of 20 with
// three spins at Singapore).
describe('recorded starts: lane changes and regression guards', () => {
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
