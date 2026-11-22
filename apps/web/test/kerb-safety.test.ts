import { NEUTRAL_INPUT } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';

const track = loadMonza();

/**
 * The game-session runs from the review of PR 19 that fired the safety net on master at
 * 22dd96e: seed 77123, teleport to (s, d) at 300 km/h, full throttle with a fixed steer, the
 * keyboard's default assists with traction control off (0) or on (2). `tick` is the review's
 * first safety reset; each case runs 15 s, the review's sweep length.
 */
const CASES: readonly (readonly [s: number, d: number, steer: number, tc: 0 | 2, tick: number])[] =
  [
    [0, -8, 0, 0, 2256],
    [0, -8, 0, 2, 2254],
    [0, 8, 0, 0, 2246],
    [0, 8, 0, 2, 2240],
    [66, 8, 0, 0, 2066],
    [66, 8, 0, 2, 2061],
    [300, -8, 0, 0, 943],
    [300, -8, 0, 2, 943],
    [300, 8, -0.1, 2, 2062],
    [300, 8, 0, 0, 1346],
    [300, 8, 0, 2, 1362],
    [540, -8, 0, 0, 270],
    [540, -8, 0, 2, 272],
    [540, 0, 0.1, 0, 651],
    [540, 8, -0.1, 0, 279],
    [540, 8, -0.1, 2, 283],
    [540, 8, 0, 0, 786],
    [540, 8, 0, 2, 749],
    [540, 8, 0.1, 0, 800],
    [610, -8, -0.1, 0, 59],
    [610, -8, -0.1, 2, 60],
    [610, -8, 0, 0, 59],
    [610, -8, 0, 2, 59],
    [610, -8, 0.1, 0, 56],
    [610, -8, 0.1, 2, 56],
    [610, 0, 0.1, 0, 1801],
    [610, 8, -0.1, 0, 530],
    [610, 8, -0.1, 2, 547],
    [610, 8, 0, 2, 538],
    [650, 8, -0.1, 0, 54],
    [650, 8, -0.1, 2, 54],
    [650, 8, 0, 0, 54],
    [650, 8, 0, 2, 54],
    [650, 8, 0.1, 0, 49],
    [650, 8, 0.1, 2, 49],
    [5600, -8, 0, 0, 2784],
    [5600, -8, 0, 2, 2782],
    [5600, 0, 0, 0, 2283],
    [5600, 0, 0, 2, 2283],
    [5600, 8, 0, 2, 2758],
  ];

/**
 * Cases that pass: fixed by the inelastic strike rule, or by it together with the contact patch
 * merged from master (#17). Every other case is still open. Traced in M4 (docs/track-data.md 5.6):
 * the cases are decided by the grade through the first chicane's folded run-off (a 9 % ramp
 * across a car's path inside turn 1, 41 % slopes inside turn 2, pinned in
 * packages/track/test/runoff-grade.test.ts); with the elevation flattened the four traced runs
 * pass, while changing the sausage kerb's height or the tyre's damping only reshuffles which
 * reset. Open cases run as expected failures, so each one turns this suite red the moment it
 * starts passing and must then move into this list.
 */
// One more passes since the folded run-off is filled (docs/track-data.md 5.8): 610,8,-0.1,0.
const FIXED = new Set([
  '300,8,-0.1,2',
  '540,8,-0.1,0',
  '540,8,-0.1,2',
  '540,8,0,0',
  '610,0,0.1,0',
  '610,8,-0.1,0',
  '650,8,-0.1,0',
  '650,8,-0.1,2',
  '650,8,0,0',
  '650,8,0,2',
  '5600,0,0,0',
  '5600,0,0,2',
]);
/**
 * Regressions: these passed with the strike fix before the merge with #17's contact patch and
 * fail after it (the patch changes each run's path through the chicane's folded run-off).
 * Listed on their own so they are not mistaken for cases that never passed.
 */
export const REGRESSED_WITH_PATCH = ['540,8,0.1,0', '610,8,-0.1,2', '5600,8,0,2'];

describe('flat-out kerb strikes in the game never need the safety net (review of PR 19)', () => {
  for (const [s, d, steer, tc, tick] of CASES) {
    const test = FIXED.has(`${s},${d},${steer},${tc}`) ? it : it.fails;
    test(`teleport(${s}, ${d}, 300 km/h), steer ${steer}, TC ${tc} (reset at tick ${tick} before)`, () => {
      const session = new DriveSession({ track, seed: 77123 });
      session.start();
      session.teleport(s, d, 300 / 3.6);
      session.setAssist('tractionControl', tc);
      // The physics under test, not the stability assist: with it on, its wheel braking keeps
      // some of these runs out of the chicane's folded run-off and they would pass for that reason.
      session.setAssist('stability', 0);
      const input = { ...NEUTRAL_INPUT, throttle: 1, steer };
      for (let k = 0; k < 240 * 15 && session.safetyResets === 0; k++)
        session.tick(input, 'keyboard');
      expect(session.safetyResets).toBe(0);
    });
  }
});
