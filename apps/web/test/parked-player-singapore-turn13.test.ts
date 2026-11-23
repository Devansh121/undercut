import { expect, it } from 'vitest';
import { parkAt } from './parked-spa';

it('Singapore turn 13, seed 1: every opponent past and home, no contact, bounded excursion', () => {
  const r = parkAt(2923, 1, 'singapore');
  expect(r.past).toBe(19);
  expect(r.finished).toBe(19);
  expect(r.peakContact).toBe(0);
  expect(r.offNear).toBeLessThanOrEqual(24);
}, 300_000);
