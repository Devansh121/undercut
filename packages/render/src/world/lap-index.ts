import type { Track } from '@undercut/track';

/** Nearest lap sample to a world point: its index, lap distance, signed offset and distance. */
export interface LapHit {
  index: number;
  s: number;
  /** Lateral offset, positive to the left of the direction of travel, m. */
  d: number;
  dist: number;
}

/**
 * Nearest centreline sample to any world point, however far from the track (the track's own
 * projection is only valid inside its frame), on a bucket grid. Used to give scenery a lap
 * distance (for chunking) and a side, and to keep it off the circuit.
 */
export class LapIndex {
  private readonly cell: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  constructor(
    private readonly track: Track,
    cell = 50,
  ) {
    const lap = track.lap;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < lap.count; i++) {
      x0 = Math.min(x0, lap.x[i] as number);
      x1 = Math.max(x1, lap.x[i] as number);
      z0 = Math.min(z0, lap.z[i] as number);
      z1 = Math.max(z1, lap.z[i] as number);
    }
    this.cell = cell;
    this.x0 = x0;
    this.z0 = z0;
    this.cols = Math.floor((x1 - x0) / cell) + 1;
    this.rows = Math.floor((z1 - z0) / cell) + 1;
    const key = (i: number): number =>
      Math.floor(((lap.z[i] as number) - z0) / cell) * this.cols +
      Math.floor(((lap.x[i] as number) - x0) / cell);
    // Prefix sums.
    const n = new Int32Array(this.cols * this.rows);
    for (let i = 0; i < lap.count; i++) n[key(i)] = (n[key(i)] as number) + 1;
    this.start = new Int32Array(this.cols * this.rows + 1);
    for (let k = 0; k < n.length; k++)
      this.start[k + 1] = (this.start[k] as number) + (n[k] as number);
    const fill = this.start.slice(0, n.length);
    this.items = new Int32Array(lap.count);
    for (let i = 0; i < lap.count; i++) {
      const k = key(i);
      this.items[fill[k] as number] = i;
      fill[k] = (fill[k] as number) + 1;
    }
  }

  /** Nearest sample, searching rings of cells outward until a hit cannot be beaten. */
  nearest(x: number, z: number, out: LapHit = { index: 0, s: 0, d: 0, dist: 0 }): LapHit {
    const lap = this.track.lap;
    const cx = Math.floor((x - this.x0) / this.cell);
    const cz = Math.floor((z - this.z0) / this.cell);
    let best = -1;
    let bestD2 = Infinity;
    const maxRing = Math.max(this.cols, this.rows) + Math.abs(cx) + Math.abs(cz);
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let j = cz - ring; j <= cz + ring; j++) {
        if (j < 0 || j >= this.rows) continue;
        for (let i = cx - ring; i <= cx + ring; i++) {
          if (i < 0 || i >= this.cols) continue;
          if (ring > 0 && j !== cz - ring && j !== cz + ring && i !== cx - ring && i !== cx + ring)
            continue;
          const k = j * this.cols + i;
          for (let e = this.start[k] as number; e < (this.start[k + 1] as number); e++) {
            const idx = this.items[e] as number;
            const dx = (lap.x[idx] as number) - x;
            const dz = (lap.z[idx] as number) - z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = idx;
            }
          }
        }
      }
      // Anything in a further ring is at least (ring) cells away from the query's cell.
      if (best >= 0 && Math.sqrt(bestD2) <= ring * this.cell) break;
    }
    const i = Math.max(0, best);
    const dx = x - (lap.x[i] as number);
    const dz = z - (lap.z[i] as number);
    out.index = i;
    out.s = i * lap.step;
    // Lateral offset along the lap normal (left positive).
    out.d = dx * (lap.nx[i] as number) + dz * (lap.nz[i] as number);
    out.dist = Math.sqrt(bestD2);
    return out;
  }

  /** Clearance from the centreline to the barrier on the side of offset d at sample i, m. */
  barrierAt(index: number, d: number): number {
    const side = d >= 0 ? 0 : 1;
    return Math.abs((this.track.barrier[side] as Float64Array)[index] as number);
  }
}
