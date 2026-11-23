import { expect, it } from 'vitest';
import { pitCarInPath } from '../../ai/src/driver/traffic';
it('sees the slowing pit entrant in the road the follower will reach before it enters the lane', () => {
  expect(pitCarInPath(0, 4, 4.5, 1, 1)).toBe(true);
  expect(pitCarInPath(0, 7, 4.5, 1, 1)).toBe(false);
});
