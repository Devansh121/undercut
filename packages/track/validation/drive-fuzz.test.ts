import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import singapore from '../data/singapore.json';
import spa from '../data/spa.json';
import { Track } from '../src/track';
import { driveFuzz } from './drive-fuzz';

// Random driving on the real circuit surfaces, in CI. The nightly soak runs more seeds for longer
// (drive-fuzz.soak.test.ts).
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SECONDS = 180;

describe.each([
  ['Monza', monza],
  ['Spa', spa],
  ['Singapore', singapore],
] as const)('random driving at %s', (_name, raw) => {
  const track = Track.fromJSON(raw);
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
