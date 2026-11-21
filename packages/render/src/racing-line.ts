import { LEFT, RIGHT, type Track } from '@undercut/track';

/**
 * An estimate of the racing line as a lateral offset per lap sample, for drawing the rubbered
 * line on the asphalt. It relaxes the path toward zero curvature inside the track edges (an
 * elastic band), which puts it on the outside before a corner, the inside at the apex and the
 * outside again on exit. Visual only: the AI's line comes from packages/ai.
 */
export function estimateRacingLine(track: Track, margin = 1.4, iterations = 1200): Float32Array {
  const lap = track.lap;
  const n = lap.count;
  const step = lap.step;
  // Work on a coarser grid for fast convergence, then interpolate back.
  const k = 4;
  const m = Math.floor(n / k);
  const h = step * k;
  const kappa = new Float64Array(m);
  const lo = new Float64Array(m);
  const hi = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const s = j * h;
    kappa[j] = track.curvatureAt(s);
    hi[j] = Math.max(0, track.halfWidthAt(s, LEFT) - margin);
    lo[j] = -Math.max(0, track.halfWidthAt(s, RIGHT) - margin);
  }
  const d = new Float64Array(m);
  // d'' + kappa (1 - kappa d) ≈ path curvature; drive it to zero, clamped to the edges.
  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < m; j++) {
      const a = d[(j - 1 + m) % m] as number;
      const b = d[(j + 1) % m] as number;
      const kj = kappa[j] as number;
      const target = (a + b) / 2 + (kj * h * h) / 2;
      d[j] = Math.min(hi[j] as number, Math.max(lo[j] as number, target));
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i / k;
    const j0 = Math.floor(f) % m;
    const j1 = (j0 + 1) % m;
    const t = f - Math.floor(f);
    out[i] = (d[j0] as number) * (1 - t) + (d[j1] as number) * t;
  }
  return out;
}
