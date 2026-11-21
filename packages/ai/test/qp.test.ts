import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import { CyclicPentaCholesky, createCyclicPenta, pentaMultiply, solveBoxQp } from '../src/line/qp';

/** A random symmetric positive-definite cyclic pentadiagonal matrix. */
function randomSpd(n: number, seed: number) {
  const rng = createRng(seed);
  const h = createCyclicPenta(n);
  for (let i = 0; i < n; i++) {
    h.d1[i] = rng.range(-0.5, 0.5);
    h.d2[i] = rng.range(-0.3, 0.3);
  }
  // Diagonally dominant, so positive definite.
  for (let i = 0; i < n; i++) {
    h.d0[i] =
      Math.abs(h.d1[i]!) +
      Math.abs(h.d1[(i + n - 1) % n]!) +
      Math.abs(h.d2[i]!) +
      Math.abs(h.d2[(i + n - 2) % n]!) +
      rng.range(0.1, 1);
  }
  return h;
}

/** Dense copy, to check the banded routines against plain linear algebra. */
function dense(h: ReturnType<typeof createCyclicPenta>): number[][] {
  const n = h.n;
  const a = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    a[i]![i] = a[i]![i]! + h.d0[i]!;
    const j1 = (i + 1) % n;
    const j2 = (i + 2) % n;
    a[i]![j1] = a[i]![j1]! + h.d1[i]!;
    a[j1]![i] = a[j1]![i]! + h.d1[i]!;
    a[i]![j2] = a[i]![j2]! + h.d2[i]!;
    a[j2]![i] = a[j2]![i]! + h.d2[i]!;
  }
  return a;
}

describe('cyclic pentadiagonal algebra', () => {
  it('multiplies like the dense matrix, including the wrap-around corners', () => {
    const n = 9;
    const h = randomSpd(n, 1);
    const a = dense(h);
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i + 1));
    const y = pentaMultiply(h, x, new Float64Array(n));
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += a[i]![j]! * x[j]!;
      expect(y[i]).toBeCloseTo(s, 12);
    }
  });

  it('solves the shifted system exactly with the banded Cholesky factor', () => {
    for (const n of [6, 7, 25, 400]) {
      const h = randomSpd(n, n);
      const chol = new CyclicPentaCholesky(h, 0.3);
      const b = Float64Array.from({ length: n }, (_, i) => Math.cos(0.7 * i));
      const x = chol.solve(b, new Float64Array(n));
      const ax = pentaMultiply(h, x, new Float64Array(n));
      for (let i = 0; i < n; i++) expect(ax[i]! + 0.3 * x[i]!).toBeCloseTo(b[i]!, 10);
    }
  });
});

describe('box-constrained QP', () => {
  it('returns the unconstrained minimiser when the box is loose', () => {
    const n = 30;
    const h = randomSpd(n, 3);
    const g = Float64Array.from({ length: n }, (_, i) => Math.sin(i));
    const lo = new Float64Array(n).fill(-100);
    const hi = new Float64Array(n).fill(100);
    const x = solveBoxQp(h, g, lo, hi).x;
    const hx = pentaMultiply(h, x, new Float64Array(n));
    for (let i = 0; i < n; i++) expect(hx[i]! + g[i]!).toBeCloseTo(0, 6);
  });

  it('meets the KKT conditions when bounds are active', () => {
    const n = 60;
    const h = randomSpd(n, 4);
    const g = Float64Array.from({ length: n }, (_, i) => 3 * Math.sin(0.3 * i));
    const lo = new Float64Array(n).fill(-1);
    const hi = new Float64Array(n).fill(1.5);
    const { x } = solveBoxQp(h, g, lo, hi, { tolerance: 1e-9 });
    const grad = pentaMultiply(h, x, new Float64Array(n));
    let active = 0;
    for (let i = 0; i < n; i++) {
      const gi = grad[i]! + g[i]!;
      expect(x[i]).toBeGreaterThanOrEqual(lo[i]! - 1e-12);
      expect(x[i]).toBeLessThanOrEqual(hi[i]! + 1e-12);
      if (x[i]! <= lo[i]! + 1e-7) {
        active++;
        expect(gi).toBeGreaterThan(-1e-5); // pushing further down would not help
      } else if (x[i]! >= hi[i]! - 1e-7) {
        active++;
        expect(gi).toBeLessThan(1e-5);
      } else {
        expect(Math.abs(gi)).toBeLessThan(1e-5);
      }
    }
    expect(active).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const n = 50;
    const h = randomSpd(n, 5);
    const g = Float64Array.from({ length: n }, (_, i) => Math.sin(i));
    const lo = new Float64Array(n).fill(-0.2);
    const hi = new Float64Array(n).fill(0.2);
    const a = solveBoxQp(h, g, lo, hi).x;
    const b = solveBoxQp(h, g, lo, hi).x;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
