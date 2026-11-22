import { SurfaceKind } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import singapore from '../data/singapore.json';
import spa from '../data/spa.json';
import { createPathPoint, createVec3 } from '../src/path';
import { createGround, Track, VERGE_FALL } from '../src/track';

/**
 * A paved run-off (and the grass and gravel beside it) is graded like the circuit it belongs to:
 * no steeper than the track's own grade and bank nearby plus the drainage fall. Where the
 * track's (s, d) frame folds (the inside of a tight corner, where a short step in the world is a
 * long step along s), a ground defined from the centreline height at the projected s turns the
 * track's grade into ramps; this is the contract that it does not.
 */
const CIRCUITS: readonly { name: string; data: unknown; open: boolean }[] = [
  // Open: the inside of the first chicane's second turn (s 645–671, d 9–14: 41 % against 10 %)
  // and the inside of the first turn (s 622, d −9.7: 24 %), where the frame folds.
  { name: 'Monza', data: monza, open: true },
  // Open: the grass on the inside of the bend at s 3200–3225, 30–36 m out (36 % against 14 %).
  { name: 'Spa', data: spa, open: true },
  { name: 'Singapore', data: singapore, open: false },
];
// Open circuits run as expected failures: each turns this suite red the moment its ground meets
// the contract, and must then move to open: false (docs/track-data.md, the folded run-off).

/** Probe spacing, m: about one tyre contact patch. */
const PROBE = 0.35;
/** How far along the lap the grade and bank count as "nearby", m. */
const NEAR = 50;
/** Allowance on top of grade, bank and drainage fall (fixed before measuring): 5 %. */
const ALLOWANCE = 0.05;

describe.each(CIRCUITS)('run-off ground at $name', ({ data, open }) => {
  const track = Track.fromJSON(data);
  const lap = track.lap;
  const n = lap.count;
  const window = Math.ceil(NEAR / lap.step);
  // Steepest grade plus bank within NEAR of each sample.
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = -window; k <= window; k++) {
      const j = (i + k + n) % n;
      m = Math.max(m, Math.abs(lap.grade[j]!) + Math.abs(track.tanBank[j]!));
    }
    local[i] = m;
  }

  const test = open ? it.fails : it;
  test('is no steeper than the nearby track grade and bank plus the drainage fall', () => {
    const p = createVec3();
    const g = createGround();
    const q = createPathPoint();
    const hint = { index: -1 };
    const pit = createPathPoint();
    // Off-track ground that is not a kerb at (x, z). The track surface itself, the kerbs
    // (profiles by design, their flanks and outer drops) and the pit lane's own ground with its
    // blend band are other contracts.
    const runoff = (x: number, z: number): boolean => {
      track.project(x, z, { index: -1 }, q);
      const s = q.s;
      const d = q.d;
      if (track.pitBlend(x, z, s, d, { index: -1 }, pit) > 0) return false;
      track.ground(s, d, g);
      return (
        g.kind !== SurfaceKind.OutOfBounds &&
        g.kind !== SurfaceKind.Kerb &&
        Math.abs(d) > track.halfWidthAt(s, d >= 0 ? 0 : 1)
      );
    };
    let worst = -Infinity;
    let where = '';
    for (let s = 0; s < track.length; s += 1) {
      for (const side of [1, -1]) {
        for (let a = 0.5; a < 120; a += 0.5) {
          lap.pointAt(s, side * a, p);
          track.project(p.x, p.z, { index: -1 }, q);
          track.ground(q.s, q.d, g);
          if (g.kind === SurfaceKind.OutOfBounds) break;
          if (!runoff(p.x + PROBE, p.z) || !runoff(p.x, p.z + PROBE) || !runoff(p.x, p.z)) {
            continue;
          }
          const h0 = track.groundHeightAt(p.x, p.z, hint);
          const hx = track.groundHeightAt(p.x + PROBE, p.z, hint);
          const hz = track.groundHeightAt(p.x, p.z + PROBE, hint);
          const slope = Math.hypot(hx - h0, hz - h0) / PROBE;
          const bound = local[g.sample]! + VERGE_FALL + ALLOWANCE;
          if (slope - bound > worst) {
            worst = slope - bound;
            where = `s ${q.s.toFixed(1)} d ${q.d.toFixed(1)}: ${(slope * 100).toFixed(1)} % against ${(bound * 100).toFixed(1)} %`;
          }
        }
      }
    }
    expect(worst, where).toBeLessThanOrEqual(0);
  }, 60_000);
});
