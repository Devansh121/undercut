/**
 * A sampled plane curve with heights, used for the lap (closed) and the pit lane (open), and the
 * (s, d) frame on it.
 *
 * Between two samples the centreline is the straight chord and the left normal is the linear
 * blend of the two sample normals (not renormalised). `pointAt(s, d)` is therefore
 * `lerp(c) + d * lerp(n)`, and `project` inverts it exactly by solving a quadratic per segment.
 * The frame is one-to-one while |d| stays below the local radius of curvature on the inside of a
 * bend; the pipeline keeps barriers inside that limit.
 */

/** Mutable 3-vector filled in place by accessors. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Result of a projection onto a path, filled in place. */
export interface PathPoint {
  s: number;
  d: number;
  /** Segment the point projected onto; feed it back as the next hint. */
  index: number;
}

export function createVec3(): Vec3 {
  return { x: 0, y: 0, z: 0 };
}

export function createPathPoint(): PathPoint {
  return { s: 0, d: 0, index: -1 };
}

const CLEARANCE_MAX = 400;
const GRID_CELL = 20;
/** Segments are indexed in every grid cell within this distance of them. */
const GRID_REACH = 80;
const MAX_WALK = 64;

export class TrackPath {
  readonly closed: boolean;
  /** Number of samples. */
  readonly count: number;
  /** Number of segments: count for a closed path, count - 1 for an open one. */
  readonly segments: number;
  /** Range of s: [0, length) closed, [0, length] open. */
  readonly length: number;
  /** s per segment (constant). */
  readonly step: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  /** Unit tangent and unit left normal at each sample. */
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  readonly nx: Float64Array;
  readonly nz: Float64Array;
  /** Signed curvature (1/m, positive turning left) and grade (dy per metre) at each sample. */
  readonly curvature: Float64Array;
  readonly grade: Float64Array;
  /** Geometric length of each segment's chord. */
  readonly chord: Float64Array;
  /**
   * Per sample and side, the lateral offset up to which this sample is certainly the nearest:
   * beyond it another sample may be closer, either across the inside of the bend (where the
   * frame folds) or on another section of the path, near or far along it.
   */
  readonly clearanceLeft: Float64Array;
  readonly clearanceRight: Float64Array;

  private readonly gx0: number;
  private readonly gz0: number;
  private readonly gw: number;
  private readonly gh: number;
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;

  // Scratch results of solve() and locate(); keeps the hot paths allocation-free.
  private st = 0;
  private sd = 0;
  private li = 0;
  private lt = 0;

  constructor(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    z: ArrayLike<number>,
    length: number,
    closed: boolean,
  ) {
    const n = x.length;
    if (n < 3 || y.length !== n || z.length !== n)
      throw new Error('a path needs three or more samples');
    this.closed = closed;
    this.count = n;
    this.segments = closed ? n : n - 1;
    this.length = length;
    this.step = length / this.segments;
    this.x = Float64Array.from(x);
    this.y = Float64Array.from(y);
    this.z = Float64Array.from(z);
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.nx = new Float64Array(n);
    this.nz = new Float64Array(n);
    this.curvature = new Float64Array(n);
    this.grade = new Float64Array(n);
    this.chord = new Float64Array(this.segments);
    for (let i = 0; i < this.segments; i++) {
      const j = this.next(i);
      this.chord[i] = Math.hypot(this.x[j]! - this.x[i]!, this.z[j]! - this.z[i]!);
    }
    for (let i = 0; i < n; i++) {
      const a = closed ? (i + n - 1) % n : Math.max(i - 1, 0);
      const b = closed ? (i + 1) % n : Math.min(i + 1, n - 1);
      const dx = this.x[b]! - this.x[a]!;
      const dz = this.z[b]! - this.z[a]!;
      const len = Math.hypot(dx, dz);
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
      // Left of travel with +Y up and +Z south: rotate the tangent by +90 degrees about +Y.
      this.nx[i] = dz / len;
      this.nz[i] = -dx / len;
      let run = 0;
      for (let k = a; k !== b; k = this.next(k)) run += this.chord[k]!;
      this.grade[i] = (this.y[b]! - this.y[a]!) / run;
      if (b - a === 2 || (closed && a !== b)) {
        const ex0 = this.x[i]! - this.x[a]!;
        const ez0 = this.z[i]! - this.z[a]!;
        const ex1 = this.x[b]! - this.x[i]!;
        const ez1 = this.z[b]! - this.z[i]!;
        const cross = ex0 * ez1 - ez0 * ex1;
        const dot = ex0 * ex1 + ez0 * ez1;
        // A left turn has negative cross in this frame (z south), hence the sign.
        this.curvature[i] = (-Math.atan2(cross, dot) * 2) / run;
      }
    }
    if (!closed) {
      this.curvature[0] = this.curvature[1]!;
      this.curvature[n - 1] = this.curvature[n - 2]!;
    }

    // Spatial index of segments for lookups without a hint.
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.x[i]!);
      maxX = Math.max(maxX, this.x[i]!);
      minZ = Math.min(minZ, this.z[i]!);
      maxZ = Math.max(maxZ, this.z[i]!);
    }
    this.gx0 = minX - GRID_REACH - GRID_CELL;
    this.gz0 = minZ - GRID_REACH - GRID_CELL;
    this.gw = Math.ceil((maxX - minX + 2 * (GRID_REACH + GRID_CELL)) / GRID_CELL);
    this.gh = Math.ceil((maxZ - minZ + 2 * (GRID_REACH + GRID_CELL)) / GRID_CELL);
    const counts = new Int32Array(this.gw * this.gh + 1);
    const visit = (fn: (cell: number, seg: number) => void): void => {
      for (let i = 0; i < this.segments; i++) {
        const j = this.next(i);
        const c0 = this.cellX(Math.min(this.x[i]!, this.x[j]!) - GRID_REACH);
        const c1 = this.cellX(Math.max(this.x[i]!, this.x[j]!) + GRID_REACH);
        const r0 = this.cellZ(Math.min(this.z[i]!, this.z[j]!) - GRID_REACH);
        const r1 = this.cellZ(Math.max(this.z[i]!, this.z[j]!) + GRID_REACH);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * this.gw + c, i);
      }
    };
    visit((cell) => {
      counts[cell + 1]!++;
    });
    for (let k = 1; k < counts.length; k++) counts[k]! += counts[k - 1]!;
    this.cellStart = counts;
    this.cellItems = new Int32Array(counts[counts.length - 1]!);
    const fill = Int32Array.from(counts);
    visit((cell, seg) => {
      this.cellItems[fill[cell]!++] = seg;
    });

    // A point at offset d from sample i can only be nearer to sample j (offset delta from i)
    // once d exceeds |delta|^2 / (2 delta.n). The smallest such d per side is the clearance.
    // Every other sample counts: on a bend the neighbours give the local radius (where the
    // frame folds), and the other leg of a chicane counts however close it is along the lap.
    this.clearanceLeft = new Float64Array(n).fill(CLEARANCE_MAX);
    this.clearanceRight = new Float64Array(n).fill(CLEARANCE_MAX);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = this.x[j]! - this.x[i]!;
        const dz = this.z[j]! - this.z[i]!;
        const dd = dx * dx + dz * dz;
        if (dd >= 4 * CLEARANCE_MAX * CLEARANCE_MAX) continue;
        const di = dx * this.nx[i]! + dz * this.nz[i]!;
        if (di !== 0) {
          const ci = di > 0 ? this.clearanceLeft : this.clearanceRight;
          const ri = dd / (2 * Math.abs(di));
          if (ri < ci[i]!) ci[i] = ri;
        }
        const dj = -dx * this.nx[j]! - dz * this.nz[j]!;
        if (dj !== 0) {
          const cj = dj > 0 ? this.clearanceLeft : this.clearanceRight;
          const rj = dd / (2 * Math.abs(dj));
          if (rj < cj[j]!) cj[j] = rj;
        }
      }
    }
  }

  /** Sample after i along the path. */
  next(i: number): number {
    return i + 1 === this.count ? 0 : i + 1;
  }

  /** s wrapped into [0, length) for a closed path, clamped to [0, length] for an open one. */
  wrap(s: number): number {
    if (!this.closed) return s < 0 ? 0 : s > this.length ? this.length : s;
    const w = s % this.length;
    return w < 0 ? w + this.length : w;
  }

  /**
   * Segment and parameter of s: after `seek(s)`, `cursor` is the segment's first sample and
   * `cursorT` the fraction along it. Lets callers blend several arrays with one lookup.
   */
  seek(s: number): void {
    this.locate(s);
    this.cursor = this.li;
    this.cursorT = this.lt;
  }

  cursor = 0;
  cursorT = 0;

  private locate(s: number): void {
    let u = s / this.step;
    if (this.closed) {
      u %= this.segments;
      if (u < 0) u += this.segments;
    } else {
      u = u < 0 ? 0 : u > this.segments ? this.segments : u;
    }
    let i = Math.floor(u);
    if (i >= this.segments) i = this.segments - 1;
    this.li = i;
    this.lt = u - i;
  }

  /** Linear interpolation of a per-sample array at s. */
  interpolate(values: ArrayLike<number>, s: number): number {
    this.locate(s);
    const a = values[this.li]!;
    return a + (values[this.next(this.li)]! - a) * this.lt;
  }

  /** Index of the sample nearest to s. */
  sampleIndex(s: number): number {
    this.locate(s);
    return this.lt < 0.5 ? this.li : this.next(this.li);
  }

  /** Centreline point at s (y is the centreline height). */
  position(s: number, out: Vec3): Vec3 {
    return this.pointAt(s, 0, out);
  }

  /** Point at lateral offset d (positive left) from the centreline at s; y is the centreline height. */
  pointAt(s: number, d: number, out: Vec3): Vec3 {
    this.locate(s);
    const i = this.li;
    const j = this.next(i);
    const t = this.lt;
    const nx = this.nx[i]! + (this.nx[j]! - this.nx[i]!) * t;
    const nz = this.nz[i]! + (this.nz[j]! - this.nz[i]!) * t;
    out.x = this.x[i]! + (this.x[j]! - this.x[i]!) * t + d * nx;
    out.z = this.z[i]! + (this.z[j]! - this.z[i]!) * t + d * nz;
    out.y = this.y[i]! + (this.y[j]! - this.y[i]!) * t;
    return out;
  }

  /** Unit tangent (direction of travel) at s; y is 0. */
  tangent(s: number, out: Vec3): Vec3 {
    this.locate(s);
    const i = this.li;
    const j = this.next(i);
    const x = this.tx[i]! + (this.tx[j]! - this.tx[i]!) * this.lt;
    const z = this.tz[i]! + (this.tz[j]! - this.tz[i]!) * this.lt;
    const len = Math.hypot(x, z);
    out.x = x / len;
    out.y = 0;
    out.z = z / len;
    return out;
  }

  /** Unit left normal at s; y is 0. */
  normal(s: number, out: Vec3): Vec3 {
    this.tangent(s, out);
    const x = out.x;
    out.x = out.z;
    out.z = -x;
    return out;
  }

  /** Solves segment i for the point (px, pz): sets st (segment parameter) and sd (offset). */
  private solve(i: number, px: number, pz: number): void {
    const j = this.next(i);
    const qx = px - this.x[i]!;
    const qz = pz - this.z[i]!;
    const ex = this.x[j]! - this.x[i]!;
    const ez = this.z[j]! - this.z[i]!;
    const n0x = this.nx[i]!;
    const n0z = this.nz[i]!;
    const dnx = this.nx[j]! - n0x;
    const dnz = this.nz[j]! - n0z;
    // (q - t e) x (n0 + t dn) = 0, with a x b = a.x b.z - a.z b.x.
    const a = -(ex * dnz - ez * dnx);
    const b = qx * dnz - qz * dnx - (ex * n0z - ez * n0x);
    const c = qx * n0z - qz * n0x;
    let t: number;
    if (Math.abs(a) <= 1e-12 * (Math.abs(b) + 1e-12)) {
      t = -c / b;
    } else {
      const disc = b * b - 4 * a * c;
      if (disc <= 0) {
        t = -b / (2 * a);
      } else {
        const r = Math.sqrt(disc);
        const q = -0.5 * (b + (b >= 0 ? r : -r));
        const t1 = q / a;
        const t2 = q !== 0 ? c / q : t1;
        t = outside(t1) <= outside(t2) ? t1 : t2;
      }
    }
    if (!Number.isFinite(t)) t = 0;
    const mx = n0x + t * dnx;
    const mz = n0z + t * dnz;
    this.st = t;
    this.sd = ((qx - t * ex) * mx + (qz - t * ez) * mz) / (mx * mx + mz * mz);
  }

  /**
   * Track coordinates of the world point (x, z). With a valid `hint` (the index from the last
   * call for the same moving point) this walks from that segment and costs a few segment
   * solves; without one (index < 0), or when the result is far enough from the centreline that
   * another section of the path could be nearer, it searches the spatial index and takes the
   * candidate with the smallest |d|. Writes `out` and updates `hint.index`.
   */
  project(px: number, pz: number, hint: { index: number }, out: PathPoint): PathPoint {
    let i = hint.index;
    if (i < 0 || i >= this.segments) {
      this.searchGlobal(px, pz, out);
      hint.index = out.index;
      return out;
    }
    let prev = -1;
    let ok = false;
    for (let k = 0; k < MAX_WALK; k++) {
      this.solve(i, px, pz);
      if (this.st >= 0 && this.st <= 1) {
        ok = true;
        break;
      }
      const to =
        this.st < 0
          ? i === 0
            ? this.closed
              ? this.segments - 1
              : -1
            : i - 1
          : i + 1 === this.segments
            ? this.closed
              ? 0
              : -1
            : i + 1;
      if (to < 0 || to === prev) {
        // Off the end of an open path, or stuck between two segments: keep this one.
        ok = to < 0;
        break;
      }
      prev = i;
      i = to;
    }
    const clearance = this.sd >= 0 ? this.clearanceLeft[i]! : this.clearanceRight[i]!;
    if (!ok || Math.abs(this.sd) > clearance) {
      this.searchGlobal(px, pz, out);
      hint.index = out.index;
      return out;
    }
    out.s = this.closed ? this.wrap((i + this.st) * this.step) : (i + this.st) * this.step;
    out.d = this.sd;
    out.index = i;
    hint.index = i;
    return out;
  }

  private cellX(x: number): number {
    const c = Math.floor((x - this.gx0) / GRID_CELL);
    return c < 0 ? 0 : c >= this.gw ? this.gw - 1 : c;
  }

  private cellZ(z: number): number {
    const c = Math.floor((z - this.gz0) / GRID_CELL);
    return c < 0 ? 0 : c >= this.gh ? this.gh - 1 : c;
  }

  private searchGlobal(px: number, pz: number, out: PathPoint): void {
    let best = -1;
    let bestT = 0;
    let bestD = Infinity;
    const inGrid =
      px >= this.gx0 &&
      pz >= this.gz0 &&
      px < this.gx0 + this.gw * GRID_CELL &&
      pz < this.gz0 + this.gh * GRID_CELL;
    if (inGrid) {
      const cell = this.cellZ(pz) * this.gw + this.cellX(px);
      for (let k = this.cellStart[cell]!; k < this.cellStart[cell + 1]!; k++) {
        const i = this.cellItems[k]!;
        this.solve(i, px, pz);
        if (this.st < -1e-9 || this.st > 1 + 1e-9) continue;
        if (Math.abs(this.sd) < Math.abs(bestD)) {
          best = i;
          bestT = this.st;
          bestD = this.sd;
        }
      }
    }
    if (best < 0) {
      // Far from the path, behind a fold, or off an open end: nearest sample, then its segments.
      let k0 = 0;
      let dmin = Infinity;
      for (let k = 0; k < this.count; k++) {
        const dd = (this.x[k]! - px) ** 2 + (this.z[k]! - pz) ** 2;
        if (dd < dmin) {
          dmin = dd;
          k0 = k;
        }
      }
      let bestOut = Infinity;
      for (let c = 0; c < 2; c++) {
        const i =
          c === 0
            ? k0 === 0
              ? this.closed
                ? this.segments - 1
                : 0
              : k0 - 1
            : Math.min(k0, this.segments - 1);
        this.solve(i, px, pz);
        const o = outside(this.st);
        if (o < bestOut || (o === bestOut && Math.abs(this.sd) < Math.abs(bestD))) {
          bestOut = o;
          best = i;
          bestT = this.st;
          bestD = this.sd;
        }
      }
      if (this.closed || (bestT >= 0 && bestT <= 1)) {
        bestT = bestT < 0 ? 0 : bestT > 1 ? 1 : bestT;
        this.solveAt(best, bestT, px, pz);
        bestD = this.sd;
      }
    }
    out.s = this.closed ? this.wrap((best + bestT) * this.step) : (best + bestT) * this.step;
    out.d = bestD;
    out.index = best;
  }

  /** Offset of (px, pz) along the blended normal at a fixed segment parameter. */
  private solveAt(i: number, t: number, px: number, pz: number): void {
    const j = this.next(i);
    const cx = this.x[i]! + (this.x[j]! - this.x[i]!) * t;
    const cz = this.z[i]! + (this.z[j]! - this.z[i]!) * t;
    const mx = this.nx[i]! + (this.nx[j]! - this.nx[i]!) * t;
    const mz = this.nz[i]! + (this.nz[j]! - this.nz[i]!) * t;
    this.sd = ((px - cx) * mx + (pz - cz) * mz) / (mx * mx + mz * mz);
  }
}

function outside(t: number): number {
  return t < 0 ? -t : t > 1 ? t - 1 : 0;
}
