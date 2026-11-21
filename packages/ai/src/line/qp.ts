/**
 * Box-constrained convex quadratic programmes with a cyclic pentadiagonal Hessian:
 *
 *     minimise ½ xᵀHx + gᵀx   subject to lo ≤ x ≤ hi
 *
 * That is the shape of every racing-line problem on a closed lap: one unknown per centreline
 * sample, a smoothness term that couples each sample to its two neighbours on either side, and
 * the track corridor as bounds. Solved with ADMM on a banded Cholesky factor, then polished to
 * the exact active set with a primal–dual active-set iteration. Pure and deterministic.
 */

/** Symmetric cyclic pentadiagonal matrix: H[i][i], H[i][i+1] and H[i][i+2], indices mod n. */
export interface CyclicPenta {
  readonly n: number;
  readonly d0: Float64Array;
  readonly d1: Float64Array;
  readonly d2: Float64Array;
}

export function createCyclicPenta(n: number): CyclicPenta {
  if (n < 6) throw new RangeError('a cyclic pentadiagonal system needs n >= 6');
  return { n, d0: new Float64Array(n), d1: new Float64Array(n), d2: new Float64Array(n) };
}

/** out = H·x. */
export function pentaMultiply(
  h: CyclicPenta,
  x: ArrayLike<number>,
  out: Float64Array,
): Float64Array {
  const n = h.n;
  for (let i = 0; i < n; i++) {
    const im1 = i === 0 ? n - 1 : i - 1;
    const im2 = i < 2 ? i + n - 2 : i - 2;
    const ip1 = i === n - 1 ? 0 : i + 1;
    const ip2 = i >= n - 2 ? i + 2 - n : i + 2;
    out[i] =
      h.d0[i]! * x[i]! +
      h.d1[i]! * x[ip1]! +
      h.d1[im1]! * x[im1]! +
      h.d2[i]! * x[ip2]! +
      h.d2[im2]! * x[im2]!;
  }
  return out;
}

/**
 * Cholesky factor of (H + shift·I) with the rows and columns of `fixed` samples replaced by the
 * identity. The factor of a cyclic pentadiagonal matrix is banded except for its last two rows,
 * which the wrap-around corners fill in, so it costs O(n) to build and to apply.
 */
export class CyclicPentaCholesky {
  readonly n: number;
  /** L[i][i-2], L[i][i-1], L[i][i] for rows 0..n-3. */
  private readonly band: Float64Array;
  /** Dense rows n-2 and n-1 of L. */
  private readonly rowA: Float64Array;
  private readonly rowB: Float64Array;

  constructor(h: CyclicPenta, shift: number, fixed?: Uint8Array) {
    const n = h.n;
    this.n = n;
    this.band = new Float64Array(3 * n);
    this.rowA = new Float64Array(n);
    this.rowB = new Float64Array(n);
    const a = (i: number, j: number): number => {
      if (i === j) return fixed && fixed[i] ? 1 : h.d0[i]! + shift;
      if (fixed && (fixed[i] || fixed[j])) return 0;
      const fwd = j - i < 0 ? j - i + n : j - i;
      if (fwd === 1) return h.d1[i]!;
      if (fwd === 2) return h.d2[i]!;
      if (fwd === n - 1) return h.d1[j]!;
      if (fwd === n - 2) return h.d2[j]!;
      return 0;
    };
    const L = (i: number, j: number): number => this.entry(i, j);
    const b = this.band;
    for (let i = 0; i < n - 2; i++) {
      for (let j = Math.max(0, i - 2); j <= i; j++) {
        let s = a(i, j);
        for (let k = Math.max(0, i - 2, j - 2); k < j; k++) s -= L(i, k) * L(j, k);
        if (j < i) b[3 * i + 2 - (i - j)] = s / b[3 * j + 2]!;
        else {
          if (!(s > 0)) throw new Error('matrix is not positive definite');
          b[3 * i + 2] = Math.sqrt(s);
        }
      }
    }
    for (const i of [n - 2, n - 1]) {
      const row = i === n - 2 ? this.rowA : this.rowB;
      for (let j = 0; j <= i; j++) {
        let s = a(i, j);
        const k0 = j < n - 2 ? Math.max(0, j - 2) : 0;
        for (let k = k0; k < j; k++) s -= row[k]! * L(j, k);
        if (j < i) row[j] = s / L(j, j);
        else {
          if (!(s > 0)) throw new Error('matrix is not positive definite');
          row[j] = Math.sqrt(s);
        }
      }
    }
  }

  private entry(i: number, j: number): number {
    const n = this.n;
    if (i === n - 2) return this.rowA[j]!;
    if (i === n - 1) return this.rowB[j]!;
    const off = i - j;
    return off >= 0 && off <= 2 ? this.band[3 * i + 2 - off]! : 0;
  }

  /** Solve (H + shift·I)·x = rhs. `out` may alias `rhs`. */
  solve(rhs: ArrayLike<number>, out: Float64Array): Float64Array {
    const n = this.n;
    const b = this.band;
    const ra = this.rowA;
    const rb = this.rowB;
    // Forward: L·y = rhs.
    for (let i = 0; i < n - 2; i++) {
      let s = rhs[i]!;
      if (i >= 1) s -= b[3 * i + 1]! * out[i - 1]!;
      if (i >= 2) s -= b[3 * i]! * out[i - 2]!;
      out[i] = s / b[3 * i + 2]!;
    }
    let s = rhs[n - 2]!;
    for (let k = 0; k < n - 2; k++) s -= ra[k]! * out[k]!;
    out[n - 2] = s / ra[n - 2]!;
    s = rhs[n - 1]!;
    for (let k = 0; k < n - 1; k++) s -= rb[k]! * out[k]!;
    out[n - 1] = s / rb[n - 1]!;
    // Backward: Lᵀ·x = y.
    out[n - 1] = out[n - 1]! / rb[n - 1]!;
    out[n - 2] = (out[n - 2]! - rb[n - 2]! * out[n - 1]!) / ra[n - 2]!;
    for (let i = n - 3; i >= 0; i--) {
      let t = out[i]! - ra[i]! * out[n - 2]! - rb[i]! * out[n - 1]!;
      if (i + 1 <= n - 3) t -= b[3 * (i + 1) + 1]! * out[i + 1]!;
      if (i + 2 <= n - 3) t -= b[3 * (i + 2)]! * out[i + 2]!;
      out[i] = t / b[3 * i + 2]!;
    }
    return out;
  }
}

export interface BoxQpOptions {
  /** ADMM penalty, relative to the mean diagonal of H. */
  rho?: number;
  maxIterations?: number;
  /** Stop when primal and dual residuals fall below this (in units of x). */
  tolerance?: number;
  /** Starting point (clamped into the box). */
  start?: ArrayLike<number>;
}

export interface BoxQpResult {
  x: Float64Array;
  admmIterations: number;
  /** True when the active-set polish found a point meeting the KKT conditions exactly. */
  polished: boolean;
}

/** Minimise ½xᵀHx + gᵀx over lo ≤ x ≤ hi. */
export function solveBoxQp(
  h: CyclicPenta,
  g: ArrayLike<number>,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  options: BoxQpOptions = {},
): BoxQpResult {
  const n = h.n;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += h.d0[i]!;
  mean /= n;
  const rho = (options.rho ?? 0.05) * mean;
  const tol = options.tolerance ?? 1e-6;
  const maxIt = options.maxIterations ?? 3000;
  const chol = new CyclicPentaCholesky(h, rho);
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const u = new Float64Array(n);
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = clamp(options.start ? options.start[i]! : 0, lo[i]!, hi[i]!);
  const alpha = 1.6; // over-relaxation
  let it = 0;
  for (; it < maxIt; it++) {
    for (let i = 0; i < n; i++) rhs[i] = rho * (z[i]! - u[i]!) - g[i]!;
    chol.solve(rhs, x);
    let primal = 0;
    let dual = 0;
    for (let i = 0; i < n; i++) {
      const xr = alpha * x[i]! + (1 - alpha) * z[i]!;
      const zOld = z[i]!;
      const zi = clamp(xr + u[i]!, lo[i]!, hi[i]!);
      z[i] = zi;
      u[i] = u[i]! + xr - zi;
      primal = Math.max(primal, Math.abs(x[i]! - zi));
      dual = Math.max(dual, Math.abs(zi - zOld));
    }
    if (primal < tol && dual < tol) break;
  }
  const polished = activeSetPolish(h, g, lo, hi, z);
  return { x: z, admmIterations: it, polished };
}

/**
 * Primal–dual active-set iteration from a near-optimal point: guess which bounds hold, solve
 * the equality-constrained problem on the rest exactly, re-guess from the multipliers, repeat
 * until the guess stops changing. Replaces `x` only when it converges to a KKT point.
 */
function activeSetPolish(
  h: CyclicPenta,
  g: ArrayLike<number>,
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  x: Float64Array,
): boolean {
  const n = h.n;
  const c = 1;
  const grad = new Float64Array(n);
  const state = new Int8Array(n); // -1 at lo, 1 at hi, 0 free
  const next = new Int8Array(n);
  const fixed = new Uint8Array(n);
  const y = new Float64Array(n);
  const rhs = new Float64Array(n);
  const tmp = new Float64Array(n);
  pentaMultiply(h, x, grad);
  for (let i = 0; i < n; i++) {
    const mu = grad[i]! + g[i]!;
    if (x[i]! <= lo[i]! + 1e-9 && mu >= 0) state[i] = -1;
    else if (x[i]! >= hi[i]! - 1e-9 && mu <= 0) state[i] = 1;
  }
  for (let iter = 0; iter < 60; iter++) {
    // Solve with the fixed set held at its bounds.
    for (let i = 0; i < n; i++) {
      fixed[i] = state[i] !== 0 ? 1 : 0;
      tmp[i] = state[i] === -1 ? lo[i]! : state[i] === 1 ? hi[i]! : 0;
    }
    // rhs on free rows: -g - H_fixed·x_fixed; on fixed rows the bound itself.
    pentaMultiply(h, tmp, rhs);
    for (let i = 0; i < n; i++) rhs[i] = fixed[i] ? tmp[i]! : -g[i]! - rhs[i]!;
    let chol: CyclicPentaCholesky;
    try {
      chol = new CyclicPentaCholesky(h, 0, fixed);
    } catch {
      return false;
    }
    chol.solve(rhs, y);
    pentaMultiply(h, y, grad);
    let changed = false;
    for (let i = 0; i < n; i++) {
      const mu = grad[i]! + g[i]!;
      let s: -1 | 0 | 1 = 0;
      if (state[i] === -1) s = mu >= 0 ? -1 : 0;
      else if (state[i] === 1) s = mu <= 0 ? 1 : 0;
      else if (y[i]! < lo[i]! - c * 1e-12) s = -1;
      else if (y[i]! > hi[i]! + c * 1e-12) s = 1;
      next[i] = s;
      if (s !== state[i]) changed = true;
    }
    if (!changed) {
      x.set(y);
      return true;
    }
    state.set(next);
  }
  return false;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
