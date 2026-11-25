/** Speed spacing and upper bound of the stopping-distance table, m/s. */
const STEP = 0.25;
const MAX_SPEED = 160;
const COUNT = MAX_SPEED / STEP + 1;

/**
 * Stopping distance from the measured speed-dependent braking capacity. Upper distances for
 * the follower and lower distances for the leader keep the reaction-distance solve cautious.
 * Derived tables contain no mutable race state and need no snapshot entries.
 */
export class BrakingCurve {
  private readonly upper = new Float64Array(COUNT);
  private readonly lower = new Float64Array(COUNT);
  private readonly upperInverse = new Float64Array(COUNT - 1);
  private readonly lowerInverse = new Float64Array(COUNT - 1);

  constructor(capacity: (speed: number) => number) {
    let previous = capacity(0);
    for (let i = 1; i < COUNT; i++) {
      const v = i * STEP;
      const next = capacity(v);
      if (!(previous > 0 && next > 0)) throw new RangeError('Nonpositive braking capacity');
      const upperInverse = 1 / Math.min(previous, next);
      const lowerInverse = 1 / Math.max(previous, next);
      const integral = 0.5 * (v * v - (v - STEP) * (v - STEP));
      this.upperInverse[i - 1] = upperInverse;
      this.lowerInverse[i - 1] = lowerInverse;
      this.upper[i] = this.upper[i - 1]! + integral * upperInverse;
      this.lower[i] = this.lower[i - 1]! + integral * lowerInverse;
      previous = next;
    }
  }

  /** Gap excludes the standing clearance; reaction is in seconds, braking scales dimensionless. */
  safeSpeed(
    room: number,
    leaderSpeed: number,
    reaction: number,
    ownScale: number,
    leaderScale: number,
  ): number {
    if (room <= 0 || !(ownScale > 0)) return 0;
    const available =
      room + this.distance(this.lower, this.lowerInverse, leaderSpeed) / leaderScale;
    let lo = 0;
    let hi = MAX_SPEED;
    for (let i = 0; i < 20; i++) {
      const v = 0.5 * (lo + hi);
      const required = this.distance(this.upper, this.upperInverse, v) / ownScale + reaction * v;
      if (required > available) hi = v;
      else lo = v;
    }
    return lo;
  }

  private distance(table: Float64Array, inverse: Float64Array, speed: number): number {
    const v = Math.max(0, Math.min(MAX_SPEED, speed));
    const i = Math.floor(v / STEP);
    if (i >= COUNT - 1) return table[COUNT - 1]!;
    const from = i * STEP;
    return table[i]! + 0.5 * (v * v - from * from) * inverse[i]!;
  }
}
