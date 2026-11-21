import { createSurfaceHint, createSurfaceSample } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import { createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { LEFT, RIGHT, Track, VERGE_FALL } from '../src/track';
import { steepestKerbSlope } from './fixtures';

/**
 * Every circuit whose data is on master. Add new ones here: the walk below is the contract
 * that the ground a car can reach has no steps in it.
 */
const CIRCUITS: readonly { name: string; data: unknown }[] = [{ name: 'Monza', data: monza }];

/** How far past the barrier line the walk goes: a car corner can never be further out. */
const MARGIN = 0.5;
/** Probe spacing: about one tyre contact patch. */
const PROBE = 0.25;

describe.each(CIRCUITS)('ground a car can reach at $name', ({ data }) => {
  const track = Track.fromJSON(data);
  const surface = new TrackSurface(track);

  // The steepest ground the data describes: kerb profile flanks on top of bank, grade and the
  // verge fall. A probe step may rise by that slope times its length, and no more.
  let bank = 0;
  let grade = 0;
  for (let i = 0; i < track.lap.count; i++) {
    bank = Math.max(bank, Math.abs(track.tanBank[i]!));
    grade = Math.max(grade, Math.abs(track.lap.grade[i]!));
  }
  const slope = steepestKerbSlope(track) + bank + grade + VERGE_FALL;
  const maxStep = slope * PROBE * Math.SQRT2 + 1e-3;

  it('has no height step between neighbouring probe points inside the barriers', () => {
    const p = createVec3();
    const a = createSurfaceSample();
    const b = createSurfaceSample();
    const fresh = createSurfaceHint();
    let worst = 0;
    let where = '';
    let probes = 0;
    const probe = (x: number, z: number): void => {
      fresh.index = -1;
      surface.sample(x, z, fresh, a);
      for (const [dx, dz] of [
        [PROBE, 0],
        [0, PROBE],
      ] as const) {
        fresh.index = -1;
        surface.sample(x + dx, z + dz, fresh, b);
        const step = Math.abs(b.height - a.height);
        probes++;
        if (step > worst) {
          worst = step;
          where = `x=${x.toFixed(2)} z=${z.toFixed(2)} (s ${a.s.toFixed(1)}, d ${a.d.toFixed(2)}, h ${a.height.toFixed(2)}) to (s ${b.s.toFixed(1)}, d ${b.d.toFixed(2)}, h ${b.height.toFixed(2)})`;
        }
      }
    };
    const ds = 1;
    for (let s = 0; s < track.length; s += ds) {
      const i = track.lap.sampleIndex(s);
      for (const side of [LEFT, RIGHT] as const) {
        const sign = side === LEFT ? 1 : -1;
        const reach = track.barrier[side][i]! + MARGIN;
        for (let u = side === LEFT ? 0 : PROBE; u <= reach; u += PROBE * 2) {
          track.lap.pointAt(s, sign * u, p);
          probe(p.x, p.z);
        }
      }
    }
    // The pit lane, which lies beyond the lap's barrier along the pit straight.
    const pit = track.pit;
    for (let sp = 0; sp <= pit.length; sp += ds) {
      const hl = pit.halfWidth(sp, LEFT) + MARGIN;
      const hr = pit.halfWidth(sp, RIGHT) + MARGIN;
      for (let d = -hr; d <= hl; d += PROBE * 2) {
        pit.path.pointAt(sp, d, p);
        probe(p.x, p.z);
      }
    }
    expect(probes).toBeGreaterThan(100_000);
    expect(worst, `worst step ${worst.toFixed(3)} m at ${where}`).toBeLessThanOrEqual(maxStep);
  });
});
