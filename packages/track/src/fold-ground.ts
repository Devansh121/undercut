/**
 * The ground beside the track where the track's (s, d) frame folds.
 *
 * Off the track the ground is the track edge's height at the projected s, falling away at the
 * drainage slope. On the inside of a tight corner the frame folds: a short step in the world is a
 * long step along s (m = 1 − κd, the frame's stretch across the lap, falls towards 0 and below),
 * or a jump to another stretch of the lap. There the track's grade turns into ramps and steps in
 * the run-off that no real paved run-off has.
 *
 * In those fold zones the base height (the ground under any kerb profile) is replaced by the
 * smoothest surface that meets its surroundings: the solution of Laplace's equation over the
 * zone, with the surrounding ground as it is (the track edges on every side, the unfolded
 * run-off) as fixed values and the barriers as free edges. It interpolates between the track
 * edges on either side and joins the unfolded ground without a seam; outside the zones nothing
 * changes.
 *
 * Solved once, on a grid, when the track is built: deterministic and independent of queries.
 */

/** Grid spacing, m. */
export const FOLD_CELL = 0.5;
/** A point is in a fold zone where the frame's stretch m = 1 − κd falls below this (estimate). */
export const FOLD_STRETCH = 0.6;
/** The fill is used in full where the stretch at the barrier is at or below this (estimate). */
export const FOLD_FULL = 0.3;

/**
 * Share of the fill for a bend whose stretch at the barrier is mBarrier: none at FOLD_STRETCH
 * (where a bend just starts to fold), all of it from FOLD_FULL, so the fill fades out towards the
 * ends of a folding stretch of lap instead of meeting the unfolded ground at a seam.
 */
export function foldShare(mBarrier: number): number {
  const t = Math.min(1, Math.max(0, (FOLD_STRETCH - mBarrier) / (FOLD_STRETCH - FOLD_FULL)));
  return t * t * (3 - 2 * t);
}

/** What a grid node is: beyond the barrier, fixed at the unfolded ground, or solved for. */
export const NodeKind = { Outside: 0, Fixed: 1, Zone: 2 } as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export interface NodeClass {
  kind: NodeKind;
  /** The unfolded base height at the node (no kerb profile). */
  height: number;
  /** For a zone node, how much of the fill to use there, 0–1 (`foldShare`). */
  weight: number;
}

export interface FoldSample {
  /** Share of the solved base, 0–1, and its world gradient. */
  weight: number;
  wx: number;
  wz: number;
  /** Solved base height (bilinear) and its world gradient. */
  height: number;
  gx: number;
  gz: number;
}

/** An axis-aligned world box to rasterise, m. */
export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const SOR = 1.85;
/** Smoothing passes over the shares after the steepness rule (each spreads it by a cell). */
const SHARE_SMOOTHING = 4;
/** Rings of nodes behind a barrier given ghost values (a blend cell is one cell wide). */
const GHOST_RINGS = 2;
const MAX_SWEEPS = 4000;
const TOLERANCE = 1e-7;

export class FoldGround {
  /** Node index by lattice key; heights, kinds. */
  private readonly index = new Map<number, number>();
  private readonly heights: Float64Array;
  private readonly kinds: Uint8Array;
  /** Blend weight per node: 1 in a zone, 0 fixed; beyond the barrier, carried from inside. */
  private readonly weights: Float64Array;
  readonly zoneNodes: number;
  readonly sweeps: number;

  constructor(boxes: readonly Box[], classify: (x: number, z: number, out: NodeClass) => void) {
    const ix: number[] = [];
    const iz: number[] = [];
    for (const b of boxes) {
      const i0 = Math.floor(b.x0 / FOLD_CELL);
      const i1 = Math.ceil(b.x1 / FOLD_CELL);
      const k0 = Math.floor(b.z0 / FOLD_CELL);
      const k1 = Math.ceil(b.z1 / FOLD_CELL);
      for (let i = i0; i <= i1; i++) {
        for (let k = k0; k <= k1; k++) {
          const key = nodeKey(i, k);
          if (this.index.has(key)) continue;
          this.index.set(key, ix.length);
          ix.push(i);
          iz.push(k);
        }
      }
    }
    const n = ix.length;
    this.heights = new Float64Array(n);
    this.kinds = new Uint8Array(n);
    const c: NodeClass = { kind: NodeKind.Outside, height: 0, weight: 0 };
    const share = new Float64Array(n);
    let zone = 0;
    for (let j = 0; j < n; j++) {
      classify(ix[j]! * FOLD_CELL, iz[j]! * FOLD_CELL, c);
      this.kinds[j] = c.kind;
      this.heights[j] = c.height;
      share[j] = c.weight;
      if (c.kind === NodeKind.Zone) zone++;
    }
    // A zone node at the edge of a box has neighbours nobody classified: fix it instead, so the
    // solve never reads outside the grid (boxes are padded, so this is rare).
    const nb = new Int32Array(4 * n).fill(-1);
    for (let j = 0; j < n; j++) {
      const i = ix[j]!;
      const k = iz[j]!;
      const around = [nodeKey(i - 1, k), nodeKey(i + 1, k), nodeKey(i, k - 1), nodeKey(i, k + 1)];
      for (let q = 0; q < 4; q++) nb[4 * j + q] = this.index.get(around[q]!) ?? -1;
      if (this.kinds[j] === NodeKind.Zone) {
        for (let q = 0; q < 4; q++) {
          if (nb[4 * j + q]! < 0) {
            this.kinds[j] = NodeKind.Fixed;
            zone--;
            break;
          }
        }
      }
    }
    this.zoneNodes = zone;
    const original = Float64Array.from(this.heights);
    // Each connected zone is filled as a hillside: the least-squares plane through the fixed
    // heights around it (the track edges, the unfolded run-off where the zone ends), plus the
    // smoothest correction that meets them (Laplace's equation for the departure from the plane,
    // by successive over-relaxation, with the barriers as free, no-flux edges). Laplace alone
    // would reproduce the fold: on a bend with a steady grade the unfolded ground already rises
    // with the angle round the bend's centre, which is harmonic, and steep near the centre.
    const comp = new Int32Array(n).fill(-1);
    const planes: number[] = [];
    const seen = new Int32Array(n).fill(-1);
    const stack: number[] = [];
    for (let j0 = 0; j0 < n; j0++) {
      if (this.kinds[j0] !== NodeKind.Zone || comp[j0]! >= 0) continue;
      const id = planes.length / 5;
      comp[j0] = id;
      stack.push(j0);
      // Sums for the plane fit, about the first boundary node to keep them well conditioned.
      let ox = NaN;
      let oz = NaN;
      let sw = 0;
      let sx = 0;
      let sz = 0;
      let sh = 0;
      let sxx = 0;
      let sxz = 0;
      let szz = 0;
      let sxh = 0;
      let szh = 0;
      while (stack.length > 0) {
        const j = stack.pop()!;
        for (let q = 0; q < 4; q++) {
          const m = nb[4 * j + q]!;
          if (m < 0) continue;
          if (this.kinds[m] === NodeKind.Zone) {
            if (comp[m]! < 0) {
              comp[m] = id;
              stack.push(m);
            }
          } else if (this.kinds[m] === NodeKind.Fixed && seen[m] !== id) {
            seen[m] = id;
            const x = ix[m]! * FOLD_CELL;
            const z = iz[m]! * FOLD_CELL;
            if (Number.isNaN(ox)) {
              ox = x;
              oz = z;
            }
            const dx = x - ox;
            const dz = z - oz;
            const h = this.heights[m]!;
            sw += 1;
            sx += dx;
            sz += dz;
            sh += h;
            sxx += dx * dx;
            sxz += dx * dz;
            szz += dz * dz;
            sxh += dx * h;
            szh += dz * h;
          }
        }
      }
      // Solve [sw sx sz; sx sxx sxz; sz sxz szz] [a b c] = [sh sxh szh]; a flat mean if singular.
      let a = sw > 0 ? sh / sw : 0;
      let bx = 0;
      let bz = 0;
      const det =
        sw * (sxx * szz - sxz * sxz) - sx * (sx * szz - sxz * sz) + sz * (sx * sxz - sxx * sz);
      if (sw >= 3 && Math.abs(det) > 1e-9 * Math.max(1, sw * sxx * szz)) {
        a =
          (sh * (sxx * szz - sxz * sxz) -
            sx * (sxh * szz - sxz * szh) +
            sz * (sxh * sxz - sxx * szh)) /
          det;
        bx =
          (sw * (sxh * szz - sxz * szh) - sh * (sx * szz - sxz * sz) + sz * (sx * szh - sxh * sz)) /
          det;
        bz =
          (sw * (sxx * szh - sxh * sxz) - sx * (sx * szh - sxh * sz) + sh * (sx * sxz - sxx * sz)) /
          det;
      }
      planes.push(Number.isNaN(ox) ? 0 : ox, Number.isNaN(oz) ? 0 : oz, a, bx, bz);
    }
    const plane = (id: number, j: number): number => {
      const o = id * 5;
      return (
        planes[o + 2]! +
        planes[o + 3]! * (ix[j]! * FOLD_CELL - planes[o]!) +
        planes[o + 4]! * (iz[j]! * FOLD_CELL - planes[o + 1]!)
      );
    };
    // Departure from the plane, solved over each zone; start from the unfolded ground.
    const r = new Float64Array(n);
    for (let j = 0; j < n; j++) if (comp[j]! >= 0) r[j] = this.heights[j]! - plane(comp[j]!, j);
    let sweep = 0;
    for (; sweep < MAX_SWEEPS && zone > 0; sweep++) {
      let change = 0;
      for (let j = 0; j < n; j++) {
        const id = comp[j]!;
        if (id < 0) continue;
        let sum = 0;
        let count = 0;
        for (let q = 0; q < 4; q++) {
          const m = nb[4 * j + q]!;
          const k = this.kinds[m];
          if (k === NodeKind.Outside) continue;
          sum += k === NodeKind.Zone ? r[m]! : this.heights[m]! - plane(id, m);
          count++;
        }
        if (count === 0) continue;
        const next = r[j]! + SOR * (sum / count - r[j]!);
        const d = Math.abs(next - r[j]!);
        if (d > change) change = d;
        r[j] = next;
      }
      if (change < TOLERANCE) break;
    }
    for (let j = 0; j < n; j++) if (comp[j]! >= 0) this.heights[j] = plane(comp[j]!, j) + r[j]!;
    this.sweeps = sweep;
    // Beyond the barrier the ground is never driven on, but a blend cell straddling the barrier
    // reads it: give the first rings of nodes behind it the values a free edge implies (the mean
    // of their neighbours inside) and their weight, so the solved ground reaches the barrier.
    // The fill never makes the ground steeper than it was: where its slope at a node exceeds the
    // original ground's, its share there is scaled down by the ratio. The shares are then
    // smoothed over the zone so the rule leaves no seams.
    const slope = (h: Float64Array, j: number): number => {
      const g = (a: number, b: number): number => {
        const ma = nb[4 * j + a]!;
        const mb = nb[4 * j + b]!;
        const okA = ma >= 0 && this.kinds[ma] !== NodeKind.Outside;
        const okB = mb >= 0 && this.kinds[mb] !== NodeKind.Outside;
        if (okA && okB) return (h[mb]! - h[ma]!) / (2 * FOLD_CELL);
        if (okB) return (h[mb]! - h[j]!) / FOLD_CELL;
        if (okA) return (h[j]! - h[ma]!) / FOLD_CELL;
        return 0;
      };
      return Math.hypot(g(0, 1), g(2, 3));
    };
    let w = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      if (this.kinds[j] !== NodeKind.Zone) continue;
      const filledSlope = slope(this.heights, j);
      const before = slope(original, j);
      w[j] = share[j]! * (filledSlope > before ? before / filledSlope : 1);
    }
    for (let pass = 0; pass < SHARE_SMOOTHING; pass++) {
      const next = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        if (this.kinds[j] !== NodeKind.Zone) continue;
        let sum = w[j]!;
        let count = 1;
        for (let q = 0; q < 4; q++) {
          const m = nb[4 * j + q]!;
          if (m < 0 || this.kinds[m] === NodeKind.Outside) continue;
          sum += w[m]!;
          count++;
        }
        next[j] = sum / count;
      }
      w = next;
    }
    this.weights = w;
    const filled = new Uint8Array(n);
    for (let j = 0; j < n; j++) if (this.kinds[j] !== NodeKind.Outside) filled[j] = 1;
    for (let ring = 0; ring < GHOST_RINGS; ring++) {
      const next: number[] = [];
      for (let j = 0; j < n; j++) {
        if (filled[j]) continue;
        let h = 0;
        let w = 0;
        let count = 0;
        for (let q = 0; q < 4; q++) {
          const m = nb[4 * j + q]!;
          if (m < 0 || !filled[m]) continue;
          h += this.heights[m]!;
          w += this.weights[m]!;
          count++;
        }
        if (count === 0) continue;
        next.push(j, h / count, w / count);
      }
      for (let q = 0; q < next.length; q += 3) {
        const j = next[q]!;
        this.heights[j] = next[q + 1]!;
        this.weights[j] = next[q + 2]!;
        filled[j] = 1;
      }
    }
  }

  /** Solved base and the weight to blend it in at (x, z); weight 0 away from fold zones. */
  sample(x: number, z: number, out: FoldSample): FoldSample {
    const u = x / FOLD_CELL;
    const v = z / FOLD_CELL;
    const i = Math.floor(u);
    const k = Math.floor(v);
    const fu = u - i;
    const fv = v - k;
    const j00 = this.index.get(nodeKey(i, k));
    const j10 = this.index.get(nodeKey(i + 1, k));
    const j01 = this.index.get(nodeKey(i, k + 1));
    const j11 = this.index.get(nodeKey(i + 1, k + 1));
    out.weight = 0;
    out.wx = 0;
    out.wz = 0;
    out.height = 0;
    out.gx = 0;
    out.gz = 0;
    if (j00 === undefined || j10 === undefined || j01 === undefined || j11 === undefined) {
      return out;
    }
    const w00 = this.weights[j00]!;
    const w10 = this.weights[j10]!;
    const w01 = this.weights[j01]!;
    const w11 = this.weights[j11]!;
    if (w00 + w10 + w01 + w11 === 0) return out;
    bilinear(w00, w10, w01, w11, fu, fv, out, true);
    bilinear(
      this.heights[j00]!,
      this.heights[j10]!,
      this.heights[j01]!,
      this.heights[j11]!,
      fu,
      fv,
      out,
      false,
    );
    return out;
  }
}

function bilinear(
  a: number,
  b: number,
  c: number,
  d: number,
  fu: number,
  fv: number,
  out: FoldSample,
  weight: boolean,
): void {
  const p = a + (b - a) * fu;
  const q = c + (d - c) * fu;
  const value = p + (q - p) * fv;
  const gx = ((b - a) * (1 - fv) + (d - c) * fv) / FOLD_CELL;
  const gz = (q - p) / FOLD_CELL;
  if (weight) {
    out.weight = value;
    out.wx = gx;
    out.wz = gz;
  } else {
    out.height = value;
    out.gx = gx;
    out.gz = gz;
  }
}

function nodeKey(i: number, k: number): number {
  return (i + 1_048_576) * 2_097_152 + (k + 1_048_576);
}
