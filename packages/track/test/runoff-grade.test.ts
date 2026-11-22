import { SurfaceKind } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import singapore from '../data/singapore.json';
import spa from '../data/spa.json';
import { createPathPoint, createVec3 } from '../src/path';
import { CAP_SLACK } from '../src/fold-ground';
import { createGround, Track, VERGE_FALL } from '../src/track';

/**
 * A paved run-off (and the grass and gravel beside it) is graded like the circuit it belongs to:
 * no steeper than the track's own grade and bank nearby plus the drainage fall. Where the
 * track's (s, d) frame folds (the inside of a tight corner, where a short step in the world is a
 * long step along s), a ground defined from the centreline height at the projected s turns the
 * track's grade into ramps; this is the contract that it does not.
 */
const CIRCUITS: readonly { name: string; data: unknown; open: boolean }[] = [
  // Open: the inside of the first chicane's second turn (s 645–671, d 9–14: 37 % against 10 %
  // with the fill, docs/track-data.md 5.8; 41 % without) and the inside of the first turn (21 %).
  { name: 'Monza', data: monza, open: true },
  // Open: the grass on the inside of the bend at s 3200–3225, 30–36 m out (36 % against 14 %).
  { name: 'Spa', data: spa, open: true },
  { name: 'Singapore', data: singapore, open: false },
];
// Open circuits run as expected failures: each turns this suite red the moment its ground meets
// the contract, and must then move to open: false (docs/track-data.md, the folded run-off).

/**
 * Probes where the run-off met the contract before the fold fill and a first version of the
 * fill broke it (review of PR 44): kept as direct checks, world x and z, m.
 */
const PATCHES: readonly { circuit: string; x: number; z: number; was: string }[] = [
  { circuit: 'Monza', x: -508.1581564466601, z: -336.28517730434737, was: 's 649, d 11.5' },
  { circuit: 'Spa', x: -109.96911077965187, z: -519.657743352458, was: 's 6679, d 13.5' },
];

/** Probe spacing, m: about one tyre contact patch. */
const PROBE = 0.35;
/** How far along the lap the grade and bank count as "nearby", m. */
const NEAR = 50;
/** Allowance on top of grade, bank and drainage fall (fixed before measuring): 5 %. */
const ALLOWANCE = 0.05;

describe.each(CIRCUITS)('run-off ground at $name', ({ name, data, open }) => {
  const track = Track.fromJSON(data);
  // The same circuit with no fill: the ground before it, which the fill is held to.
  const original = Track.fromJSON(data, { fillFolds: false });
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

  const g = createGround();
  const q = createPathPoint();
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
  /** Ground slope at (x, z) over the probe, as the probe sees it. */
  const slopeAt = (t: Track, x: number, z: number): number => {
    const hint = { index: -1 };
    const h0 = t.groundHeightAt(x, z, hint);
    const hx = t.groundHeightAt(x + PROBE, z, hint);
    const hz = t.groundHeightAt(x, z + PROBE, hint);
    return Math.hypot(hx - h0, hz - h0) / PROBE;
  };
  /** The contract's bound at (x, z), or null where (x, z) is not a run-off probe. */
  const boundAt = (x: number, z: number): number | null => {
    if (!runoff(x + PROBE, z) || !runoff(x, z + PROBE) || !runoff(x, z)) return null;
    return local[g.sample]! + VERGE_FALL + ALLOWANCE;
  };

  // One sweep over the run-off, with and without the fill.
  let swept: { worst: number; where: string; broken: string[]; steeper: string[] } | null = null;
  const sweep = (): NonNullable<typeof swept> => {
    if (swept) return swept;
    const p = createVec3();
    let worst = -Infinity;
    let where = '';
    const broken: string[] = [];
    const steeper: string[] = [];
    for (let s = 0; s < track.length; s += 1) {
      for (const side of [1, -1]) {
        for (let a = 0.5; a < 120; a += 0.5) {
          lap.pointAt(s, side * a, p);
          track.project(p.x, p.z, { index: -1 }, q);
          track.ground(q.s, q.d, g);
          if (g.kind === SurfaceKind.OutOfBounds) break;
          const bound = boundAt(p.x, p.z);
          if (bound === null) continue;
          const slope = slopeAt(track, p.x, p.z);
          const before = slopeAt(original, p.x, p.z);
          const at = `s ${q.s.toFixed(1)} d ${q.d.toFixed(1)}: ${(before * 100).toFixed(2)} % → ${(slope * 100).toFixed(2)} % against ${(bound * 100).toFixed(2)} %`;
          if (slope - bound > worst) {
            worst = slope - bound;
            where = at;
          }
          if (before <= bound && slope > bound) broken.push(at);
          // The fill's own rule allows CAP_SLACK for rounding (1e-7 %).
          if (slope > Math.max(before, bound) + CAP_SLACK) steeper.push(at);
        }
      }
    }
    swept = { worst, where, broken, steeper };
    return swept;
  };

  const test = open ? it.fails : it;
  test('is no steeper than the nearby track grade and bank plus the drainage fall', () => {
    const { worst, where } = sweep();
    expect(worst, where).toBeLessThanOrEqual(0);
  }, 60_000);

  it('keeps every probe that met the contract before the fill within it', () => {
    expect(sweep().broken).toEqual([]);
  }, 60_000);

  it('is nowhere steeper with the fill than without it, unless still within the contract', () => {
    expect(sweep().steeper).toEqual([]);
  }, 60_000);

  for (const patch of PATCHES.filter((c) => c.circuit === name)) {
    it(`keeps the run-off at ${patch.was} within the contract`, () => {
      const bound = boundAt(patch.x, patch.z);
      expect(bound).not.toBeNull();
      expect(slopeAt(original, patch.x, patch.z)).toBeLessThanOrEqual(bound!);
      expect(slopeAt(track, patch.x, patch.z)).toBeLessThanOrEqual(bound!);
    });
  }
});
