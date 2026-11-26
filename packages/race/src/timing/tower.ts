/**
 * Mini-sector crossing times for a timing tower. The lap is cut into `count` equal mini-sectors
 * measured from the timing line; each car records the (tick-interpolated) time it first reaches
 * every boundary of its race distance. Interpolating the car ahead's timeline at the trailing
 * car's current distance gives a broadcast gap: how long ago the car ahead was where this car
 * is now. Every leader gap uses that same timeline, so the gaps follow current race order.
 *
 * Each car keeps its last lap and a bit of boundaries in a ring, so memory and snapshots stay
 * small however long the race.
 */
export interface TowerState {
  last: (number | null)[];
  /** Per car, ring of [boundary index, time] pairs flattened. */
  ring: number[][];
}

export class GapTower {
  readonly count: number;
  readonly step: number;
  private readonly size: number;
  private last: (number | null)[];
  private readonly scratch = { prevDist: 0, dist: 0 };
  private readonly clock = { prev: 0, now: 0 };
  private ring: number[][];

  constructor(cars: number, length: number, spacing = 150) {
    this.count = Math.max(4, Math.round(length / spacing));
    this.step = length / this.count;
    this.size = this.count + 4;
    this.last = Array.from({ length: cars }, () => null);
    this.ring = Array.from({ length: cars }, () => new Array<number>(2 * this.size).fill(-1));
  }

  /** The car's race distance went from `prev` (at `prevT`) to `cur` (at `curT`). */
  update(car: number, prev: number, cur: number, prevT: number, curT: number): void {
    this.scratch.prevDist = prev;
    this.scratch.dist = cur;
    this.clock.prev = prevT;
    this.clock.now = curT;
    this.advance(car, this.scratch, this.clock);
  }

  /** `update` taking the distances and times by reference (no boxed numbers on the hot path). */
  advance(
    car: number,
    d: { readonly prevDist: number; readonly dist: number },
    clock: { readonly prev: number; readonly now: number },
  ): void {
    const prev = d.prevDist;
    const cur = d.dist;
    const prevT = clock.prev;
    const curT = clock.now;
    if (!(cur > prev)) return;
    const first = Math.floor(prev / this.step) + 1;
    const lastK = Math.floor(cur / this.step);
    const done = this.last[car] ?? -Infinity;
    const r = this.ring[car]!;
    for (let k = Math.max(first, done + 1); k <= lastK; k++) {
      const f = (k * this.step - prev) / (cur - prev);
      const slot = (((k % this.size) + this.size) % this.size) * 2;
      r[slot] = k;
      r[slot + 1] = prevT + f * (curT - prevT);
      this.last[car] = k;
    }
  }

  /** Latest boundary the car has reached, or null. */
  lastBoundary(car: number): number | null {
    return this.last[car] ?? null;
  }

  /** Time the car reached boundary `k`, or null when it has not or it is no longer kept. */
  timeAt(car: number, k: number): number | null {
    const r = this.ring[car]!;
    const slot = (((k % this.size) + this.size) % this.size) * 2;
    return r[slot] === k ? (r[slot + 1] as number) : null;
  }

  /**
   * Gap at the last boundary the trailing car crossed, for historical timing reads.
   * Live standings use timeAtDistance so all rows refer to current race distance.
   */
  gap(behind: number, ahead: number): number | null {
    const k = this.last[behind];
    if (k === null || k === undefined) return null;
    const a = this.timeAt(ahead, k);
    const b = this.timeAt(behind, k);
    return a === null || b === null ? null : b - a;
  }

  /**
   * Interpolate when `car` reached a race distance using its mini-sector history. The live
   * endpoint fills the partial mini-sector. Reading every gap from the same leader timeline
   * keeps gaps ordered by current distance, even when the pack brakes between boundaries.
   * Returns null before the first shared timing boundary or after history has expired.
   */
  timeAtDistance(
    car: number,
    distance: number,
    currentDistance: number,
    now: number,
  ): number | null {
    if (distance < 0 || distance > currentDistance) return null;
    const k = Math.floor(distance / this.step);
    const from = this.timeAt(car, k);
    if (from === null) return null;
    const next = this.timeAt(car, k + 1);
    const endDistance = next === null ? currentDistance : (k + 1) * this.step;
    const endTime = next ?? now;
    const startDistance = k * this.step;
    if (endDistance <= startDistance) return from;
    const f = (distance - startDistance) / (endDistance - startDistance);
    return from + f * (endTime - from);
  }

  getState(): TowerState {
    return { last: this.last.slice(), ring: this.ring.map((r) => r.slice()) };
  }

  setState(s: TowerState): void {
    this.last = s.last.slice();
    this.ring = s.ring.map((r) => r.slice());
  }
}
