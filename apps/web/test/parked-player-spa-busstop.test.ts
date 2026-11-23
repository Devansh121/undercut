import { describe, expect, it } from 'vitest';
import { parkAt } from './parked-spa';

describe('the player stopped on the racing line at the Bus Stop, Spa', () => {
  it.each([1, 2])(
    'seed %i: every car past and home, no contact over 2 m/s, none off the road',
    (seed) => {
      const r = parkAt(6690, seed);
      expect(r.past).toBe(19);
      expect(r.finished).toBe(19);
      expect(r.peakContact).toBeLessThan(2);
      expect(r.offNear).toBe(0);
    },
    300_000,
  );
});
