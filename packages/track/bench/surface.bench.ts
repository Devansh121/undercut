/**
 * Micro-benchmark of the per-wheel ground query on Monza. Each iteration runs CALLS queries, so
 * divide the reported mean time by CALLS for the cost per call (or read the printed summary).
 *
 *   npm run track:bench
 */
import { createSurfaceHint, createSurfaceSample } from '@undercut/sim';
import { bench, describe } from 'vitest';
import raw from '../data/monza.json';
import { createPathPoint, createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { Track } from '../src/track';

const CALLS = 1000;
const track = Track.fromJSON(raw);
const surface = new TrackSurface(track);
const out = createSurfaceSample();
const q = createPathPoint();

// Four wheels of a car lapping at about 300 km/h with 120 Hz ticks: 0.7 m per tick, wheels at
// +/-0.8 m and +/-1.8 m from the car centre, weaving across the track.
const TICKS = 8192;
const wheels = 4;
const xs = new Float64Array(TICKS * wheels);
const zs = new Float64Array(TICKS * wheels);
const p = createVec3();
for (let t = 0; t < TICKS; t++) {
  const s = t * 0.7;
  const d = 4 * Math.sin(s / 90);
  const offsets = [
    [1.8, 0.8],
    [1.8, -0.8],
    [-1.8, 0.8],
    [-1.8, -0.8],
  ] as const;
  offsets.forEach(([ds, dd], w) => {
    track.lap.pointAt(s + ds, d + dd, p);
    xs[t * wheels + w] = p.x;
    zs[t * wheels + w] = p.z;
  });
}
const hints = Array.from({ length: wheels }, createSurfaceHint);
let cursor = 0;

describe(`Monza ground query (${CALLS} calls per iteration)`, () => {
  bench('TrackSurface.sample, one hint per wheel', () => {
    for (let k = 0; k < CALLS; k++) {
      const w = cursor % wheels;
      surface.sample(xs[cursor]!, zs[cursor]!, hints[w]!, out);
      cursor = (cursor + 1) % (TICKS * wheels);
    }
  });

  bench('TrackSurface.sample, no hint', () => {
    for (let k = 0; k < CALLS; k++) {
      surface.sample(xs[cursor]!, zs[cursor]!, createSurfaceHint(), out);
      cursor = (cursor + 1) % (TICKS * wheels);
    }
  });

  const lapHints = Array.from({ length: wheels }, () => ({ index: -1 }));
  bench('Track.project, one hint per wheel', () => {
    for (let k = 0; k < CALLS; k++) {
      track.project(xs[cursor]!, zs[cursor]!, lapHints[cursor % wheels]!, q);
      cursor = (cursor + 1) % (TICKS * wheels);
    }
  });
});
