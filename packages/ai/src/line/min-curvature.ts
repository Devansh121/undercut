import type { Track } from '@undercut/track';
import type { Corridor } from './corridor';
import { createCyclicPenta, solveBoxQp } from './qp';

/**
 * Minimum-curvature racing line: the offsets d[i] inside the corridor that minimise the sum of
 * squared curvature around the lap.
 *
 * Line point i is p_i = c_i + d_i·n_i (centreline point and left normal). Its curvature is
 * approximately ν_i·(p_{i-1} − 2p_i + p_{i+1}) / ℓ_i², with ν_i the line's own unit normal and ℓ_i
 * its local sample spacing. With ν and ℓ frozen at the previous iterate that is linear in d, so
 * each step is a box-constrained QP with a cyclic pentadiagonal Hessian (see `qp.ts`); a few
 * Gauss–Newton steps settle ν and ℓ. A tiny ridge on d keeps the problem strictly convex where
 * a straight leaves the line free to sit anywhere.
 */
export interface MinCurvatureOptions {
  iterations?: number;
  /** Weight of the ridge term ε·Σd², relative to the curvature term's scale. */
  ridge?: number;
  /** Starting offsets (default: the corridor's middle). */
  start?: ArrayLike<number>;
}

export interface MinCurvatureResult {
  d: Float64Array;
  /** Σκ² (1/m²) of the final line, by the same discrete measure. */
  cost: number;
  polished: boolean;
}

export function minimumCurvatureLine(
  track: Track,
  corridor: Corridor,
  options: MinCurvatureOptions = {},
): MinCurvatureResult {
  const lap = track.lap;
  const n = lap.count;
  const iterations = options.iterations ?? 6;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = options.start ? options.start[i]! : 0.5 * (corridor.lo[i]! + corridor.hi[i]!);
  }
  const h = createCyclicPenta(n);
  const g = new Float64Array(n);
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  let polished = true;
  const ridge = options.ridge ?? 1e-6;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      px[i] = lap.x[i]! + d[i]! * lap.nx[i]!;
      pz[i] = lap.z[i]! + d[i]! * lap.nz[i]!;
    }
    h.d0.fill(0);
    h.d1.fill(0);
    h.d2.fill(0);
    g.fill(0);
    let scale = 0;
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n;
      const b = (i + 1) % n;
      // Line normal (left of travel) and spacing at i, from the current iterate.
      const tx = px[b]! - px[a]!;
      const tz = pz[b]! - pz[a]!;
      const tl = Math.hypot(tx, tz);
      const vx = tz / tl;
      const vz = -tx / tl;
      const l0 = Math.hypot(px[i]! - px[a]!, pz[i]! - pz[a]!);
      const l1 = Math.hypot(px[b]! - px[i]!, pz[b]! - pz[i]!);
      const ell = 0.5 * (l0 + l1);
      const w = 1 / (ell * ell);
      // r_i = w·(b_i + α_a d_a + α_i d_i + α_b d_b).
      const ax = lap.x[a]! - 2 * lap.x[i]! + lap.x[b]!;
      const az = lap.z[a]! - 2 * lap.z[i]! + lap.z[b]!;
      const bi = w * (vx * ax + vz * az);
      const ca = w * (vx * lap.nx[a]! + vz * lap.nz[a]!);
      const ci = w * -2 * (vx * lap.nx[i]! + vz * lap.nz[i]!);
      const cb = w * (vx * lap.nx[b]! + vz * lap.nz[b]!);
      // H += 2·αᵀα and g += 2·b·α over the index triple (a, i, b).
      h.d0[a] = h.d0[a]! + 2 * ca * ca;
      h.d0[i] = h.d0[i]! + 2 * ci * ci;
      h.d0[b] = h.d0[b]! + 2 * cb * cb;
      h.d1[a] = h.d1[a]! + 2 * ca * ci; // (a, a+1 = i)
      h.d1[i] = h.d1[i]! + 2 * ci * cb; // (i, i+1 = b)
      h.d2[a] = h.d2[a]! + 2 * ca * cb; // (a, a+2 = b)
      g[a] = g[a]! + 2 * bi * ca;
      g[i] = g[i]! + 2 * bi * ci;
      g[b] = g[b]! + 2 * bi * cb;
      scale += 2 * ci * ci;
    }
    const eps = ridge * (scale / n);
    for (let i = 0; i < n; i++) h.d0[i] = h.d0[i]! + 2 * eps;
    const result = solveBoxQp(h, g, corridor.lo, corridor.hi, { start: d });
    polished = result.polished;
    d.set(result.x);
  }
  return { d, cost: curvatureCost(track, d), polished };
}

/** Σκ² by the discrete measure the optimiser uses (turning angle over spacing). */
export function curvatureCost(track: Track, d: ArrayLike<number>): number {
  const lap = track.lap;
  const n = lap.count;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n;
    const b = (i + 1) % n;
    const x0 = lap.x[a]! + d[a]! * lap.nx[a]!;
    const z0 = lap.z[a]! + d[a]! * lap.nz[a]!;
    const x1 = lap.x[i]! + d[i]! * lap.nx[i]!;
    const z1 = lap.z[i]! + d[i]! * lap.nz[i]!;
    const x2 = lap.x[b]! + d[b]! * lap.nx[b]!;
    const z2 = lap.z[b]! + d[b]! * lap.nz[b]!;
    const ex0 = x1 - x0;
    const ez0 = z1 - z0;
    const ex1 = x2 - x1;
    const ez1 = z2 - z1;
    const k =
      (2 * Math.atan2(ex0 * ez1 - ez0 * ex1, ex0 * ex1 + ez0 * ez1)) /
      (Math.hypot(ex0, ez0) + Math.hypot(ex1, ez1));
    sum += k * k;
  }
  return sum;
}
