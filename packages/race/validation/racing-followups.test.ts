import { describe, expect, it } from 'vitest';
import { expectQuickRace } from './lib/expect-race';
import { runFollowupRace } from './lib/followup-proof';

describe('recorded lane-change and moving-pack starts', () => {
  for (const seed of [1022, 7307, 4114380179]) {
    it(`Monza seed ${seed}: no hard contact or spin, every car classified`, () => {
      const run = runFollowupRace('monza', seed);
      expectQuickRace(run, 1);
      expect(Math.max(...run.cars.map((c) => c.maxContactSpeed))).toBeLessThan(3);
    }, 180_000);
  }
});

for (const circuit of ['monza', 'spa', 'singapore'] as const) {
  it(`${circuit}: faster cars pass over five laps without a spin or hard contact`, () => {
    const run = runFollowupRace(circuit, 17, 5);
    expectQuickRace(run, 5);
    expect(run.racing.overtakes).toBeGreaterThan(0);
    expect(Math.max(...run.cars.map((c) => c.maxContactSpeed))).toBeLessThan(3);
  }, 300_000);
}
