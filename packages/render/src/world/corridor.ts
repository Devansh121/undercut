import { bounds, inRing } from './dressing';
import type { LapIndex } from './lap-index';

/**
 * The drivable corridor: the track, its run-off and the barriers that close it, out to the
 * barrier line on each side, and this margin beyond it (the walls' own width, m).
 */
export const CORRIDOR_MARGIN = 1;

/** Spacing of the points tested along a footprint's outline, m. */
const EDGE_STEP = 2;

/**
 * Does a mapped footprint (flat x, z ring) reach into the drivable corridor? Any point along its
 * outline (every 2 m) inside the barriers plus the margin, or any centreline sample inside the
 * footprint (one that spans the whole road, outline beyond both walls). The whole footprint is
 * judged, not its centre: a long building can stand far from the track at its centre and still
 * cross it.
 */
export function footprintOnTrack(
  p: readonly number[],
  lap: LapIndex,
  margin = CORRIDOR_MARGIN,
): boolean {
  const m = p.length / 2;
  if (m < 2) return false;
  const hit = { index: 0, s: 0, d: 0, dist: 0 };
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const ax = p[2 * i] as number;
    const az = p[2 * i + 1] as number;
    const bx = p[2 * j] as number;
    const bz = p[2 * j + 1] as number;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / EDGE_STEP));
    for (let k = 0; k < n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      lap.nearest(x, z, hit);
      if (hit.dist <= lap.barrierAt(hit.index, hit.d) + margin) return true;
    }
  }
  const [x0, z0, x1, z1] = bounds(p);
  let inside = false;
  lap.forEachSampleIn(x0, z0, x1, z1, (_i, x, z) => (inside = inRing(p, x, z)));
  return inside;
}
