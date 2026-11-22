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
 * A query blends the solved height into the original ground by a weight, both bilinear between
 * nodes. The fill may make the ground no steeper than the original ground, or than the slope the
 * caller allows there (the run-off contract's bound, docs/track-data.md 5.6), whichever is
 * higher; that rule is enforced on the final blended field, every term of its gradient
 * included, at check points a quarter of a cell (12.5 cm) apart (`enforceCap`). It holds at those
 * points and at the run-off contract's 0.35 m probe scale; between check points the point-scale
 * slope can exceed it by up to about 1.5 percentage points.
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
  /** For a zone node, how far the fill has grown in from the kerb strip's edge, 0–1. */
  ramp: number;
}

/** The original (unfilled) ground at a world point, as a query reads it. */
export interface OriginalGround {
  height: number;
  /** World gradient. */
  gx: number;
  gz: number;
  /**
   * The slope the fill may always reach there, whatever the original ground: the run-off
   * contract's bound (the track's grade and bank nearby, the drainage fall and the allowance).
   */
  floor: number;
}

export interface FoldSample {
  /** Share of the solved height, 0–1 (bilinear), and its world gradient. */
  weight: number;
  wx: number;
  wz: number;
  /** Solved height (bilinear) and its world gradient. */
  height: number;
  gx: number;
  gz: number;
  /** False where every node around the point has weight 0: the original ground stands. */
  active: boolean;
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
  /** Blend weight per node: 0 on fixed nodes; beyond the barrier, carried from inside. */
  private readonly weights: Float64Array;
  readonly zoneNodes: number;
  readonly sweeps: number;
  /** Passes of the steepness rule over the final field before it held everywhere. */
  readonly capPasses: number;
  /** Points of the final field the steepness rule was checked at. */
  readonly capPoints: number;

  /**
   * `classify` describes a grid node; `originalAt` gives the unfilled ground at a world point and
   * returns false where it is not driven on (beyond the barrier).
   */
  constructor(
    boxes: readonly Box[],
    classify: (x: number, z: number, out: NodeClass) => void,
    originalAt: (x: number, z: number, out: OriginalGround) => boolean,
  ) {
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
    const c: NodeClass = { kind: NodeKind.Outside, height: 0, weight: 0, ramp: 0 };
    const share = new Float64Array(n);
    const ramp = new Float64Array(n);
    let zone = 0;
    for (let j = 0; j < n; j++) {
      classify(ix[j]! * FOLD_CELL, iz[j]! * FOLD_CELL, c);
      this.kinds[j] = c.kind;
      this.heights[j] = c.height;
      share[j] = c.weight;
      ramp[j] = c.ramp;
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
    // The fill's share at each node: where the solved surface is steeper than the original
    // ground, its share there is scaled down by the ratio, and the shares are smoothed over the
    // zone so that first pass leaves no seams. It only shapes the fill; the rule itself is
    // enforced on the final field below.
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
    // The weight: share times the ramp in from the kerb strip.
    const weights = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      if (this.kinds[j] === NodeKind.Zone) weights[j] = w[j]! * ramp[j]!;
    }
    // Beyond the barrier the ground is never driven on, but a cell straddling the barrier reads
    // it: give the first rings of nodes behind it the values a free edge implies (the mean of
    // their neighbours inside) and their weight, so the solved ground reaches the barrier.
    const filled = new Uint8Array(n);
    for (let j = 0; j < n; j++) if (this.kinds[j] !== NodeKind.Outside) filled[j] = 1;
    for (let ring = 0; ring < GHOST_RINGS; ring++) {
      const next: number[] = [];
      for (let j = 0; j < n; j++) {
        if (filled[j]) continue;
        let h = 0;
        let wsum = 0;
        let count = 0;
        for (let q = 0; q < 4; q++) {
          const m = nb[4 * j + q]!;
          if (m < 0 || !filled[m]) continue;
          h += this.heights[m]!;
          wsum += weights[m]!;
          count++;
        }
        if (count === 0) continue;
        next.push(j, h / count, wsum / count);
      }
      for (let q = 0; q < next.length; q += 3) {
        const j = next[q]!;
        this.heights[j] = next[q + 1]!;
        weights[j] = next[q + 2]!;
        filled[j] = 1;
      }
    }
    this.weights = weights;
    const cap = enforceCap(ix, iz, nb, this.heights, weights, originalAt);
    this.capPasses = cap.passes;
    this.capPoints = cap.points;
  }

  /** Solved height and the weight to blend it in at (x, z); inactive away from fold zones. */
  sample(x: number, z: number, out: FoldSample): FoldSample {
    const u = x / FOLD_CELL;
    const v = z / FOLD_CELL;
    const i = Math.floor(u);
    const k = Math.floor(v);
    out.weight = 0;
    out.wx = 0;
    out.wz = 0;
    out.height = 0;
    out.gx = 0;
    out.gz = 0;
    out.active = false;
    const j00 = this.index.get(nodeKey(i, k));
    const j10 = this.index.get(nodeKey(i + 1, k));
    const j01 = this.index.get(nodeKey(i, k + 1));
    const j11 = this.index.get(nodeKey(i + 1, k + 1));
    if (j00 === undefined || j10 === undefined || j01 === undefined || j11 === undefined) {
      return out;
    }
    const w = this.weights;
    if (w[j00] === 0 && w[j10] === 0 && w[j01] === 0 && w[j11] === 0) return out;
    const fu = u - i;
    const fv = v - k;
    const h = this.heights;
    out.weight = bilinear(w[j00]!, w[j10]!, w[j01]!, w[j11]!, fu, fv, scratch);
    out.wx = scratch.gx;
    out.wz = scratch.gz;
    out.height = bilinear(h[j00]!, h[j10]!, h[j01]!, h[j11]!, fu, fv, scratch);
    out.gx = scratch.gx;
    out.gz = scratch.gz;
    out.active = true;
    return out;
  }
}

const scratch = { gx: 0, gz: 0 };

/** Bilinear value at (fu, fv) in a cell; its world gradient goes to `grad`. */
function bilinear(
  a: number,
  b: number,
  c: number,
  d: number,
  fu: number,
  fv: number,
  grad: { gx: number; gz: number },
): number {
  const p = a + (b - a) * fu;
  const q = c + (d - c) * fu;
  grad.gx = ((b - a) * (1 - fv) + (d - c) * fv) / FOLD_CELL;
  grad.gz = (q - p) / FOLD_CELL;
  return p + (q - p) * fv;
}

/** Points per cell side the steepness rule is checked at. */
const CAP_SPLIT = 4;
/** Slack on the steepness rule for rounding, as a slope. */
export const CAP_SLACK = 1e-9;
/** Passes that scale weights down by the factor a point needs; after them, weights are cut. */
const CAP_SCALE_PASSES = 200;
/** Steps (as shares of a node's target weight) tried when growing weights back, largest first. */
const GROW_STEPS = [0.25, 0.1, 0.05, 0.02];
/** Sweeps over the nodes per step. */
const GROW_SWEEPS = 4;

/**
 * Enforce the steepness rule on the final field. At points CAP_SPLIT to a cell side across every
 * cell the fill reaches, the ground a query reads, H = O + W (F − O) with O the original ground
 * and W, F the bilinear weight and solved height, has the gradient
 *
 *   ∇H = ∇O + W (∇F − ∇O) + (F − O) ∇W,
 *
 * which must be no steeper than the original there or than the point's floor slope, whichever is
 * higher. First the weights are scaled down until every point holds: a violating point scales
 * its cell's four weights (and so the last two terms) by the largest factor that satisfies it,
 * and the passes repeat (weights only shrink, and with no weight every point holds, so this
 * ends). Then each node's weight is grown back towards its target in steps, a step kept only if
 * every point of the cells around the node still holds, so the field stays within the rule.
 * A cell the grid does not wholly cover reads as the original ground, so its weights are cut.
 */
function enforceCap(
  ix: readonly number[],
  iz: readonly number[],
  nb: Int32Array,
  heights: Float64Array,
  weights: Float64Array,
  originalAt: (x: number, z: number, out: OriginalGround) => boolean,
): { passes: number; points: number } {
  const n = weights.length;
  // Cells with weight, by their lower-left node, and the points to check in each.
  const cellOf = new Int32Array(n).fill(-1);
  const cells: number[] = [];
  for (let j = 0; j < n; j++) {
    const j10 = nb[4 * j + 1]!;
    const j01 = nb[4 * j + 3]!;
    const j11 = j10 >= 0 ? nb[4 * j10 + 3]! : -1;
    const corners = [j, j10, j01, j11];
    if (!corners.some((m) => m >= 0 && weights[m]! > 0)) continue;
    if (j10 < 0 || j01 < 0 || j11 < 0) {
      for (const m of corners) if (m >= 0) weights[m] = 0;
      continue;
    }
    cellOf[j] = cells.length;
    cells.push(j);
  }
  // Per point: the cell's corners, (fu, fv), the original's height and gradient, the limit, and
  // the solved height and gradient. Points of cell c are first[c] .. first[c + 1] − 1.
  const corner: number[] = [];
  const at: number[] = [];
  const first = new Int32Array(cells.length + 1);
  const o: OriginalGround = { height: 0, gx: 0, gz: 0, floor: 0 };
  const g = { gx: 0, gz: 0 };
  for (let c = 0; c < cells.length; c++) {
    const j = cells[c]!;
    const j10 = nb[4 * j + 1]!;
    const j01 = nb[4 * j + 3]!;
    const j11 = nb[4 * j10 + 3]!;
    first[c] = corner.length / 4;
    for (let a = 0; a < CAP_SPLIT; a++) {
      for (let b = 0; b < CAP_SPLIT; b++) {
        const fu = a / CAP_SPLIT;
        const fv = b / CAP_SPLIT;
        if (!originalAt((ix[j]! + fu) * FOLD_CELL, (iz[j]! + fv) * FOLD_CELL, o)) continue;
        const f = bilinear(heights[j]!, heights[j10]!, heights[j01]!, heights[j11]!, fu, fv, g);
        corner.push(j, j10, j01, j11);
        const limit = Math.max(Math.hypot(o.gx, o.gz), o.floor) + CAP_SLACK;
        at.push(fu, fv, o.height, o.gx, o.gz, limit, f, g.gx, g.gz);
      }
    }
  }
  first[cells.length] = corner.length / 4;
  const points = corner.length / 4;
  // The largest factor on point p's weight terms that keeps it within its limit (1: holds).
  const fit = (p: number): number => {
    const c0 = corner[4 * p]!;
    const c1 = corner[4 * p + 1]!;
    const c2 = corner[4 * p + 2]!;
    const c3 = corner[4 * p + 3]!;
    const q = 9 * p;
    const ax = at[q + 3]!;
    const az = at[q + 4]!;
    const limit = at[q + 5]!;
    const w = bilinear(
      weights[c0]!,
      weights[c1]!,
      weights[c2]!,
      weights[c3]!,
      at[q]!,
      at[q + 1]!,
      g,
    );
    if (w === 0 && g.gx === 0 && g.gz === 0) return 1;
    const diff = at[q + 6]! - at[q + 2]!;
    const bx = w * (at[q + 7]! - ax) + diff * g.gx;
    const bz = w * (at[q + 8]! - az) + diff * g.gz;
    const aa = ax * ax + az * az;
    const ab = ax * bx + az * bz;
    const bb = bx * bx + bz * bz;
    if (aa + 2 * ab + bb <= limit * limit) return 1;
    // Largest t with |a + t b| <= limit (t = 0 satisfies it, as |a| <= limit).
    return Math.max(0, (-ab + Math.sqrt(Math.max(0, ab * ab - bb * (aa - limit * limit)))) / bb);
  };
  const target = Float64Array.from(weights);
  const scale = new Float64Array(n);
  let passes = 1;
  for (; ; passes++) {
    scale.fill(1);
    let violations = 0;
    for (let p = 0; p < points; p++) {
      const r = fit(p);
      if (r >= 1) continue;
      const t = passes > CAP_SCALE_PASSES ? 0 : r * (1 - 1e-6);
      violations++;
      for (let k = 4 * p; k < 4 * p + 4; k++) {
        const m = corner[k]!;
        if (t < scale[m]!) scale[m] = t;
      }
    }
    if (violations === 0) break;
    for (let j = 0; j < n; j++) weights[j] = weights[j]! * scale[j]!;
  }
  // Grow back. The cells around node j have lower-left nodes j, its left, lower and lower-left
  // neighbours.
  const holds = (j: number): boolean => {
    const left = nb[4 * j]!;
    const down = nb[4 * j + 2]!;
    const around = [j, left, down, left >= 0 ? nb[4 * left + 2]! : -1];
    for (const m of around) {
      if (m < 0) continue;
      const c = cellOf[m]!;
      if (c < 0) continue;
      for (let p = first[c]!; p < first[c + 1]!; p++) if (fit(p) < 1) return false;
    }
    return true;
  };
  for (const step of GROW_STEPS) {
    for (let sweep = 0; sweep < GROW_SWEEPS; sweep++) {
      for (let j = 0; j < n; j++) {
        const goal = target[j]!;
        const now = weights[j]!;
        if (now >= goal) continue;
        weights[j] = Math.min(goal, now + step * goal);
        if (!holds(j)) weights[j] = now;
      }
    }
  }
  return { passes, points };
}

function nodeKey(i: number, k: number): number {
  return (i + 1_048_576) * 2_097_152 + (k + 1_048_576);
}
