import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import { Track } from '../src/track';
import { REVIEW_SIM_CASES, reviewRun } from './review-cases';

// Regressions from the review of PR 19: flat-out runs at 300 km/h that hit Monza's kerbs (and
// scraped its barriers) and threw the car past its pose limits. Each runs the review's 18 s.
// Cases that pass now. Seed 94146 passed with the strike fix alone and regressed after the merge
// with #17's contact patch (roll 0.305 rad at tick 775 against the review's 0.3 probe); 97513
// passes since the merge. The rest are still open (kerb and barrier strikes at the first chicane,
// see apps/web/test/kerb-safety.test.ts and docs/track-data.md 5.6) and run as expected failures, so each one turns this
// suite red the moment it passes and must then move into this list.
const FIXED = new Set([97513]);

describe('flat-out kerb strikes at Monza (review of PR 19)', () => {
  const track = Track.fromJSON(monza);
  for (const [seed, s, mode] of REVIEW_SIM_CASES) {
    const test = FIXED.has(seed) ? it : it.fails;
    test(`seed ${seed}, s ${s}, ${mode}: pose in bounds for 18 s`, () => {
      const r = reviewRun(track, seed, s, mode);
      expect(r.failure).toBeNull();
    });
  }

  it('is deterministic', () => {
    const [seed, s, mode] = REVIEW_SIM_CASES[8]!;
    expect(reviewRun(track, seed, s, mode, 4).snapshot).toEqual(
      reviewRun(track, seed, s, mode, 4).snapshot,
    );
  });
});
