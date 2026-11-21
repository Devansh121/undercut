import { BufferAttribute, BufferGeometry } from 'three';
import { hash01, type MappedFeature } from './dressing';
import type { LapIndex } from './lap-index';

/** A grandstand fitted to a mapped footprint: an oriented rectangle facing the track. */
export interface StandFrame {
  id: string;
  /** Front-left corner on the ground (track side), m. */
  ox: number;
  oz: number;
  /** Unit vector along the front edge, and into the stand (away from the track). */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  length: number;
  depth: number;
  base: number;
  rows: number;
  roof: boolean;
  /** Lap distance of the stand's middle, for chunking its crowd. */
  s: number;
  seat: [number, number, number];
}

/** Seating geometry constants, m. */
export const STAND = {
  frontWall: 1.6,
  rowDepth: 0.85,
  rowRise: 0.42,
  backWall: 2.6,
  maxRows: 34,
};

/** Seat colours of the stands (invented; no circuit's real scheme). */
const SEATS: [number, number, number][] = [
  [0.05, 0.12, 0.3],
  [0.32, 0.33, 0.35],
  [0.05, 0.14, 0.09],
  [0.36, 0.04, 0.03],
  [0.2, 0.21, 0.24],
];

/**
 * Fit a footprint: principal axis by the second moments of its points, the long side nearer the
 * centreline as the front, so the rows rise away from the track.
 */
export function fitStand(
  f: MappedFeature,
  lap: LapIndex,
  ground: (x: number, z: number) => number,
  n: number,
): StandFrame | null {
  const p = f.p;
  const m = p.length / 2;
  if (m < 3) return null;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < m; i++) {
    cx += p[2 * i] as number;
    cz += p[2 * i + 1] as number;
  }
  cx /= m;
  cz /= m;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (let i = 0; i < m; i++) {
    const dx = (p[2 * i] as number) - cx;
    const dz = (p[2 * i + 1] as number) - cz;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let ax = Math.cos(ang);
  let az = Math.sin(ang);
  let lo = Infinity;
  let hi = -Infinity;
  let lo2 = Infinity;
  let hi2 = -Infinity;
  for (let i = 0; i < m; i++) {
    const dx = (p[2 * i] as number) - cx;
    const dz = (p[2 * i + 1] as number) - cz;
    const u = dx * ax + dz * az;
    const v = -dx * az + dz * ax;
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
    lo2 = Math.min(lo2, v);
    hi2 = Math.max(hi2, v);
  }
  const length = hi - lo;
  let depth = hi2 - lo2;
  if (length < 6 || depth < 3) return null;
  // Perpendicular b0 = (-az, ax). The frame must keep b = (-az, ax) for the faces to point out,
  // so when the front is on the +b0 side both axes flip.
  const b0x = -az;
  const b0z = ax;
  const midU = (lo + hi) / 2;
  const near = (v: number): number =>
    lap.nearest(cx + ax * midU + b0x * v, cz + az * midU + b0z * v).dist;
  let cornerX: number;
  let cornerZ: number;
  let bx = b0x;
  let bz = b0z;
  if (near(hi2) < near(lo2)) {
    cornerX = cx + ax * hi + b0x * hi2;
    cornerZ = cz + az * hi + b0z * hi2;
    ax = -ax;
    az = -az;
    bx = -bx;
    bz = -bz;
  } else {
    cornerX = cx + ax * lo + b0x * lo2;
    cornerZ = cz + az * lo + b0z * lo2;
  }
  depth = Math.min(depth, STAND.frontWall + STAND.maxRows * STAND.rowDepth + 1.5);
  const rows = Math.max(3, Math.min(STAND.maxRows, Math.floor((depth - 1.2) / STAND.rowDepth)));
  let base = Infinity;
  for (const [u, v] of [
    [0, 0],
    [length, 0],
    [0, depth],
    [length, depth],
  ] as const) {
    base = Math.min(base, ground(cornerX + ax * u + bx * v, cornerZ + az * u + bz * v));
  }
  const mid = lap.nearest(cornerX + ax * length * 0.5, cornerZ + az * length * 0.5);
  return {
    id: f.id,
    ox: cornerX,
    oz: cornerZ,
    ax,
    az,
    bx,
    bz,
    length,
    depth: rows * STAND.rowDepth + 1.2,
    base: base - 0.3,
    rows,
    roof: rows >= 10 || f.t?.['roof:shape'] !== undefined,
    s: mid.s,
    seat: SEATS[Math.floor(hash01(n, 5) * SEATS.length)] as [number, number, number],
  };
}

/** Geometry builder with vertex colours. */
class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  quad(
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    d: readonly number[],
    colour: readonly number[],
  ): void {
    // a b c d counter-clockwise seen from the front.
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const e2 = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!];
    let nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
    let ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
    let nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const base = this.pos.length / 3;
    for (const v of [a, b, c, d]) {
      this.pos.push(v[0]!, v[1]!, v[2]!);
      this.nor.push(nx, ny, nz);
      this.col.push(colour[0]!, colour[1]!, colour[2]!);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Axis box from a local frame: origin, unit axes a (length), b (depth), y up. */
  box(
    f: StandFrame,
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    y0: number,
    y1: number,
    colour: readonly number[],
  ): void {
    const P = (u: number, v: number, y: number): number[] => [
      f.ox + f.ax * u + f.bx * v,
      f.base + y,
      f.oz + f.az * u + f.bz * v,
    ];
    // Front (v0), back (v1), left (u0), right (u1), top, all faces outward.
    this.quad(P(u1, v0, y0), P(u0, v0, y0), P(u0, v0, y1), P(u1, v0, y1), colour);
    this.quad(P(u0, v1, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v1, y1), colour);
    this.quad(P(u0, v0, y0), P(u0, v1, y0), P(u0, v1, y1), P(u0, v0, y1), colour);
    this.quad(P(u1, v1, y0), P(u1, v0, y0), P(u1, v0, y1), P(u1, v1, y1), colour);
    this.quad(P(u0, v0, y1), P(u0, v1, y1), P(u1, v1, y1), P(u1, v0, y1), colour);
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(new BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

const CONCRETE = [0.42, 0.41, 0.39];
const STEEL = [0.3, 0.31, 0.33];
const ROOF = [0.55, 0.56, 0.57];

/** Height of row r's tread above the stand's base, m. */
export function rowHeight(r: number): number {
  return STAND.frontWall + r * STAND.rowRise;
}

/**
 * Grandstand structures: a concrete front wall, one stepped tread and riser per row with the
 * seat colour along its front, side walls, a back wall, a cantilever roof on steel columns over
 * bigger stands, and access stairs (a lighter step band) every 25 m.
 */
export function buildStands(frames: readonly StandFrame[]): BufferGeometry {
  const b = new Builder();
  for (const f of frames) {
    const L = f.length;
    const top = rowHeight(f.rows);
    // Front wall.
    b.box(f, 0, L, 0, 0.3, 0, STAND.frontWall, CONCRETE);
    // Rows: tread (concrete) and the seat band at its front edge.
    for (let r = 0; r < f.rows; r++) {
      const v0 = 0.3 + r * STAND.rowDepth;
      const v1 = v0 + STAND.rowDepth;
      const y = rowHeight(r);
      b.box(f, 0, L, v0, v1, 0, y, CONCRETE);
      b.box(f, 0, L, v0 + 0.05, v0 + 0.5, y, y + 0.42, f.seat);
    }
    const back = 0.3 + f.rows * STAND.rowDepth;
    b.box(f, 0, L, back, back + 0.3, 0, top + STAND.backWall, CONCRETE);
    // Side walls rising with the rake.
    b.box(f, -0.3, 0, 0, back + 0.3, 0, top + 1.0, CONCRETE);
    b.box(f, L, L + 0.3, 0, back + 0.3, 0, top + 1.0, CONCRETE);
    // Stairs: a lighter band of steps every 25 m (drawn over the seats).
    for (let u = 12; u < L - 6; u += 25) {
      for (let r = 0; r < f.rows; r++) {
        const v0 = 0.3 + r * STAND.rowDepth;
        b.box(
          f,
          u - 0.6,
          u + 0.6,
          v0,
          v0 + STAND.rowDepth,
          0,
          rowHeight(r) + 0.02 + 0.21,
          [0.5, 0.5, 0.48],
        );
      }
    }
    if (f.roof) {
      const ry = top + STAND.backWall + 2.2;
      const over = back * 0.25;
      // Columns at the back, every 12 m.
      for (
        let u = 0.5;
        u <= L - 0.5;
        u += Math.max(6, (L - 1) / Math.max(1, Math.round((L - 1) / 12)))
      ) {
        b.box(f, u - 0.2, u + 0.2, back - 0.1, back + 0.3, 0, ry, STEEL);
      }
      // Roof plate sloping down to the front, a fascia under its front edge.
      const P = (u: number, v: number, y: number): number[] => [
        f.ox + f.ax * u + f.bx * v,
        f.base + y,
        f.oz + f.az * u + f.bz * v,
      ];
      const yf = ry - 0.6;
      b.quad(
        P(-0.5, over, yf),
        P(-0.5, back + 0.6, ry),
        P(L + 0.5, back + 0.6, ry),
        P(L + 0.5, over, yf),
        ROOF,
      );
      b.quad(
        P(L + 0.5, over, yf - 0.05),
        P(L + 0.5, back + 0.6, ry - 0.05),
        P(-0.5, back + 0.6, ry - 0.05),
        P(-0.5, over, yf - 0.05),
        STEEL,
      );
      b.quad(
        P(-0.5, over, yf - 1.0),
        P(L + 0.5, over, yf - 1.0),
        P(L + 0.5, over, yf),
        P(-0.5, over, yf),
        [0.12, 0.13, 0.14],
      );
    }
  }
  return b.build();
}

/** Seat positions for the crowd: per stand, per row, every 0.55 m, kept with probability `fill`. */
export function crowdSeats(
  frames: readonly StandFrame[],
  fill: (f: StandFrame, row: number) => number,
): { x: number; y: number; z: number; yaw: number; s: number; k: number }[] {
  const out: { x: number; y: number; z: number; yaw: number; s: number; k: number }[] = [];
  let k = 0;
  for (const f of frames) {
    // Facing the track: -b.
    const yaw = Math.atan2(f.bz, -f.bx);
    for (let r = 0; r < f.rows; r++) {
      const p = fill(f, r);
      const v = 0.3 + r * STAND.rowDepth + 0.38;
      const y = f.base + rowHeight(r) + 0.42;
      for (let u = 0.5; u < f.length - 0.4; u += 0.55) {
        k++;
        if (hash01(k, 77) > p) continue;
        const uj = u + (hash01(k, 78) - 0.5) * 0.12;
        out.push({
          x: f.ox + f.ax * uj + f.bx * v,
          y,
          z: f.oz + f.az * uj + f.bz * v,
          yaw,
          s: f.s,
          k,
        });
      }
    }
  }
  return out;
}
