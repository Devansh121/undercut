import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import { Track } from '../src/track';
import { driveFuzz } from './drive-fuzz';

// Random driving on the real Monza surface, in CI. The nightly soak runs more seeds for longer
// (drive-fuzz.soak.test.ts).
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SECONDS = 180;

describe('random driving at Monza', () => {
  const track = Track.fromJSON(monza);
  let contacts = 0;
  for (const seed of SEEDS) {
    it(`seed ${seed}: ${SECONDS} s with the pose in bounds and the car inside the barriers`, () => {
      const r = driveFuzz(track, seed, SECONDS);
      expect(r.failure).toBeNull();
      // Contact runs every substep; a corner ends a step under one substep's travel past a face.
      expect(r.deepest).toBeLessThan(0.1);
      // The ground never steps; a floor or rim strike only ever happens on a kerb.
      expect(r.groundSteps).toBe(0);
      expect(r.otherStrikes).toBe(0);
      contacts += r.wallSteps;
    });
  }
  it('drove into the barriers along the way', () => {
    expect(contacts).toBeGreaterThan(0);
  });
});
