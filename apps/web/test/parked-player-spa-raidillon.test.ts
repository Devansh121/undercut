import { describe, expect, it } from 'vitest';
import { parkAt } from './parked-spa';

describe('the player stopped on the racing line at Raidillon, Spa', () => {
  it('seed 3: every car past and home, no contact over 2 m/s, none off the road', () => {
    const r = parkAt(1024, 3);
    expect(r.past).toBe(19);
    expect(r.finished).toBe(19);
    expect(r.peakContact).toBeLessThan(2);
    expect(r.offNear).toBe(0);
  }, 300_000);

  for (const seed of [1, 2]) {
    it(`seed ${seed}: every car past and home, no contact over 2 m/s, none off the road`, () => {
      const r = parkAt(1024, seed);
      expect(r.past).toBe(19);
      expect(r.finished).toBe(19);
      expect(r.peakContact).toBeLessThan(2);
      expect(r.offNear).toBe(0);
    }, 300_000);
  }
});
