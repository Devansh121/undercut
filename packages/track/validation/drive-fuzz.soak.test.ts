import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import { Track } from '../src/track';
import { driveFuzz } from './drive-fuzz';

// Nightly: the CI drive fuzz at full length, 100 seeds of ten minutes each (16.7 h of driving).
describe('random driving at Monza, nightly', () => {
  const track = Track.fromJSON(monza);
  for (let seed = 1000; seed < 1100; seed++) {
    it(`seed ${seed}: 600 s`, () => {
      const r = driveFuzz(track, seed, 600);
      expect(r.failure).toBeNull();
      expect(r.deepest).toBeLessThan(0.1);
      expect(r.groundSteps).toBe(0);
      expect(r.contactLifts).toBe(0);
    });
  }
});
