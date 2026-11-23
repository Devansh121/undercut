import { expect, it } from 'vitest';
import { parkAt } from './parked-spa';

it('Singapore turn 13, seed 1: every opponent past and home, no contact, bounded excursion', () => {
  const r = parkAt(2923, 1, 'singapore');
  expect(r.past).toBe(19);
  expect(r.finished).toBe(19);
  expect(r.peakContact).toBe(0);
  // No more than the same window counts with no stopped car at all (13; this reads 4).
  expect(r.offNear).toBeLessThanOrEqual(13);
}, 300_000);
