/**
 * Mini-sector crossing times for a timing tower. The lap is cut into `count` equal mini-sectors
 * measured from the timing line; each car records the (tick-interpolated) time it first reaches
 * every boundary of its race distance. A gap between two cars is the difference of their times
 * at the same boundary, so it updates smoothly, about every 150 m, and means the same thing as
 * a broadcast gap: how long ago the car ahead was where this car is now.
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
   * How far `behind` trails `ahead` in time at the last boundary `behind` reached, s; null
   * when they have no boundary in common (start of the race, or `ahead` a lap or more up).
   */
  gap(behind: number, ahead: number): number | null {
    const k = this.last[behind];
    if (k === null || k === undefined) return null;
    const a = this.timeAt(ahead, k);
    const b = this.timeAt(behind, k);
    return a === null || b === null ? null : b - a;
  }

  getState(): TowerState {
    return { last: this.last.slice(), ring: this.ring.map((r) => r.slice()) };
  }

  setState(s: TowerState): void {
    this.last = s.last.slice();
    this.ring = s.ring.map((r) => r.slice());
  }
}
