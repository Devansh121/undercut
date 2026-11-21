import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import { TrackPath, createPathPoint, createVec3 } from '../src/path';
import { stadium } from './fixtures';

function circle(radius: number, n: number, clockwise: boolean): TrackPath {
  const x: number[] = [];
  const z: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    // Clockwise seen from above (+Y) with +Z south: start north, head east.
    x.push(radius * Math.sin(a));
    z.push(clockwise ? -radius * Math.cos(a) : radius * Math.cos(a));
  }
  const chord = 2 * radius * Math.sin(Math.PI / n);
  return new TrackPath(x, new Array<number>(n).fill(0), z, chord * n, true);
}

describe('TrackPath frame', () => {
  it('has unit tangents, left normals and signed curvature on a circle', () => {
    const cw = circle(100, 400, true);
    const ccw = circle(100, 400, false);
    for (const i of [0, 37, 200, 399]) {
      expect(Math.hypot(cw.tx[i]!, cw.tz[i]!)).toBeCloseTo(1, 12);
      expect(cw.tx[i]! * cw.nx[i]! + cw.tz[i]! * cw.nz[i]!).toBeCloseTo(0, 12);
      // Clockwise turns right: negative curvature; the left normal points away from the centre.
      expect(cw.curvature[i]).toBeCloseTo(-1 / 100, 6);
      expect(ccw.curvature[i]).toBeCloseTo(1 / 100, 6);
      expect(cw.x[i]! * cw.nx[i]! + cw.z[i]! * cw.nz[i]!).toBeGreaterThan(0);
    }
    // At the start (north) heading east, left is north: -Z.
    expect(cw.tx[0]).toBeCloseTo(1, 6);
    expect(cw.nz[0]).toBeCloseTo(-1, 6);
  });

  it('wraps s and measures grade', () => {
    const n = 200;
    const x: number[] = [];
    const z: number[] = [];
    const y: number[] = [];
    for (let k = 0; k < n; k++) {
      x.push(k * 2);
      z.push(0);
      y.push(k * 2 * 0.03);
    }
    const open = new TrackPath(x, y, z, (n - 1) * 2, false);
    expect(open.grade[50]).toBeCloseTo(0.03, 9);
    expect(open.wrap(-5)).toBe(0);
    expect(open.wrap(1e6)).toBe(open.length);
    const loop = circle(50, 100, true);
    expect(loop.wrap(-1)).toBeCloseTo(loop.length - 1, 9);
    expect(loop.wrap(loop.length + 3)).toBeCloseTo(3, 9);
  });

  it('pointAt and project are exact inverses on and off the centreline', () => {
    const path = circle(80, 300, true);
    const rng = createRng(7);
    const p = createVec3();
    const q = createPathPoint();
    for (let k = 0; k < 2000; k++) {
      const s = rng.next() * path.length;
      // Inside the bend the frame is valid up to the radius; outside without limit.
      const d = -60 + rng.next() * 130;
      path.pointAt(s, d, p);
      path.project(p.x, p.z, { index: -1 }, q);
      const ds = Math.abs(((q.s - s + path.length * 1.5) % path.length) - path.length / 2);
      expect(ds).toBeLessThan(1e-6);
      expect(q.d).toBeCloseTo(d, 6);
    }
  });

  it('gives the same answer with and without a hint, and the walk follows a moving point', () => {
    const { x, z, length } = stadium(300, 50, 2);
    const path = new TrackPath(x, new Array<number>(x.length).fill(0), z, length, true);
    const hint = { index: -1 };
    const a = createPathPoint();
    const b = createPathPoint();
    const p = createVec3();
    for (let s = 0; s < 3 * length; s += 0.7) {
      path.pointAt(s, 3 * Math.sin(s / 40), p);
      path.project(p.x, p.z, hint, a);
      path.project(p.x, p.z, { index: -1 }, b);
      expect(a.s).toBeCloseTo(b.s, 6);
      expect(a.d).toBeCloseTo(b.d, 6);
    }
  });

  it('picks the nearer section where the path comes back on itself', () => {
    // A long, narrow stadium: the two straights are 30 m apart.
    const { x, z, length } = stadium(500, 15, 2);
    const path = new TrackPath(x, new Array<number>(x.length).fill(0), z, length, true);
    const q = createPathPoint();
    // Start on the north straight, then jump to a point 4 m from the south straight
    // with the stale hint: it must land on the south straight.
    const hint = { index: -1 };
    path.project(0, -15, hint, q);
    expect(q.s).toBeCloseTo(250, 6);
    // Heading west on the south straight, north is to the right.
    path.project(10, 11, hint, q);
    expect(q.d).toBeCloseTo(-4, 6);
    expect(q.s).toBeGreaterThan(500 + 15 * Math.PI);
    expect(path.clearanceRight[path.sampleIndex(250)]).toBeCloseTo(15, 1); // half the gap between the straights
    expect(path.clearanceLeft[path.sampleIndex(250)]).toBe(400);
  });

  it('handles points far from the path and off the ends of an open path', () => {
    const n = 100;
    const x = Array.from({ length: n }, (_, k) => k * 2);
    const zero = new Array<number>(n).fill(0);
    const open = new TrackPath(x, zero, zero, (n - 1) * 2, false);
    const q = createPathPoint();
    open.project(-10, -3, { index: -1 }, q);
    expect(q.s).toBeCloseTo(-10, 6);
    expect(q.d).toBeCloseTo(3, 6);
    open.project(500, 0, { index: 3 }, q);
    expect(q.s).toBeCloseTo(500, 6);
    open.project(100, -900, { index: -1 }, q);
    expect(q.s).toBeCloseTo(100, 6);
    expect(q.d).toBeCloseTo(900, 6);
  });
});
