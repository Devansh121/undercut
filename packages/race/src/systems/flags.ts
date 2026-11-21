import { forward, type RaceCore, type RaceSystem } from '../core';

/**
 * Local yellows and blue flags. (The chequered flag belongs to the core's finish logic; the
 * black and white flag to track limits.)
 *
 * Yellow: the lap is cut into marshalling sectors from the timing line. A car on or near the
 * track (within `yellowReach` of the centreline, outside the pit lane) that is slower than
 * `yellowSpeed` for `yellowDelay` puts out a yellow in its sector and the one before it; the
 * flag stays until `yellowClearTime` after the cause has gone. DRS is disabled in a zone that
 * touches a yellow sector; passing a car inside one is a warning (no penalty yet).
 *
 * Blue (race): shown to a car when a car about to lap it is within `blueGap` behind, measured
 * at the timing tower's mini-sectors. The lapped car has `blueWindow` to let it by, or it gets
 * `bluePenalty`. Drivers read the flag through the session.
 */
interface BlueState {
  by: number;
  since: number;
  penalised: boolean;
}

export interface FlagsState {
  slowSince: (number | null)[];
  until: (number | null)[];
  on: boolean[];
  blue: (BlueState | null)[];
  greenAt: number | null;
}

/** Hold-off after lights out (or the green) before slow cars set yellows: the start itself, s. */
const START_GRACE = 4;

export class FlagSystem implements RaceSystem<FlagsState> {
  readonly sectorCount: number;
  private readonly sectorLength: number;
  private readonly timingLine: number;
  private readonly length: number;
  private slowSince: (number | null)[];
  private until: (number | null)[];
  private on: boolean[];
  private blue: (BlueState | null)[];
  private greenAt: number | null = null;

  constructor(cars: number, length: number, timingLine: number, marshalSector: number) {
    this.length = length;
    this.timingLine = timingLine;
    this.sectorCount = Math.max(3, Math.round(length / marshalSector));
    this.sectorLength = length / this.sectorCount;
    this.slowSince = Array.from({ length: cars }, () => null);
    this.blue = Array.from({ length: cars }, () => null);
    this.until = Array.from({ length: this.sectorCount }, () => null);
    this.on = Array.from({ length: this.sectorCount }, () => false);
  }

  /** Marshalling sector of lap s. */
  sectorAt(s: number): number {
    return Math.min(
      this.sectorCount - 1,
      Math.floor(forward(this.length, this.timingLine, s) / this.sectorLength),
    );
  }

  yellowAt(s: number): boolean {
    return this.on[this.sectorAt(s)]!;
  }

  /** Any yellow sector overlapping lap s range [from, to). */
  yellowBetween(from: number, to: number): boolean {
    const span = forward(this.length, from, to);
    for (let x = 0; x <= span; x += this.sectorLength / 2) {
      if (this.yellowAt(from + x)) return true;
    }
    return this.yellowAt(to);
  }

  yellowSectors(): readonly boolean[] {
    return this.on;
  }

  /** Car about to lap this one, when the blue flag is out for it; else -1. */
  blueFor(car: number): number {
    return this.blue[car]?.by ?? -1;
  }

  tick(core: RaceCore): void {
    const { rules } = core;
    const live = core.phase === 'green' || core.phase === 'chequered';
    if (!live) return;
    this.greenAt ??= core.lightsOutAt ?? core.prevTime;
    const graceOver = core.time > this.greenAt + START_GRACE;
    // ---- Yellow ----
    for (let i = 0; i < core.cars.length; i++) {
      const f = core.facts[i]!;
      const car = core.cars[i]!;
      const slow =
        graceOver &&
        car.finishTime === null &&
        !f.inPitLane &&
        f.speed < rules.yellowSpeed &&
        Math.abs(f.d) < rules.yellowReach;
      if (!slow) {
        this.slowSince[i] = null;
        continue;
      }
      this.slowSince[i] ??= core.time;
      if (core.time - this.slowSince[i]! >= rules.yellowDelay) {
        const k = this.sectorAt(f.s);
        const hold = core.time + rules.yellowClearTime;
        this.until[k] = hold;
        this.until[(k + this.sectorCount - 1) % this.sectorCount] = hold;
      }
    }
    for (let k = 0; k < this.sectorCount; k++) {
      const want = this.until[k] !== null && core.time <= this.until[k]!;
      if (!want) this.until[k] = null;
      if (want !== this.on[k]) {
        this.on[k] = want;
        core.emit({ type: 'flag', t: core.time, flag: 'yellow', on: want, sector: k });
      }
    }
    // Passing under yellow: a warning for now.
    for (let i = 0; i < core.cars.length; i++) {
      if (!core.racing(i) || core.facts[i]!.inPitLane || !this.yellowAt(core.facts[i]!.s)) continue;
      const me = core.cars[i]!;
      for (let j = 0; j < core.cars.length; j++) {
        if (j === i || !core.racing(j) || core.facts[j]!.inPitLane) continue;
        const other = core.cars[j]!;
        if (me.prevDist < other.prevDist && me.dist > other.dist) {
          core.emit({ type: 'warning', t: core.time, car: i, reason: 'overtakeUnderYellow' });
        }
      }
    }
    // ---- Blue ----
    if (!core.strategy.blueFlags) return;
    const L = this.length;
    const tower = core.tower;
    for (let x = 0; x < core.cars.length; x++) {
      const cur = this.blue[x] ?? null;
      let by = -1;
      let best = Infinity;
      if (core.racing(x) && !core.facts[x]!.inPitLane) {
        const dx = core.cars[x]!.dist;
        for (let y = 0; y < core.cars.length; y++) {
          if (y === x || !core.racing(y) || core.facts[y]!.inPitLane) continue;
          const dy = core.cars[y]!.dist;
          if (!(dy > dx + L / 2 && dy < dx + L)) continue;
          const ky = tower.lastBoundary(y);
          if (ky === null) continue;
          const tx = tower.timeAt(x, ky - tower.count);
          const ty = tower.timeAt(y, ky);
          if (tx === null || ty === null) continue;
          const gap = ty - tx;
          const limit = cur?.by === y ? rules.blueGap + 0.5 : rules.blueGap;
          if (gap < limit && gap < best) {
            best = gap;
            by = y;
          }
        }
      }
      if (by < 0) {
        if (cur) {
          this.blue[x] = null;
          core.emit({ type: 'flag', t: core.time, flag: 'blue', on: false, car: x, by: cur.by });
        }
        continue;
      }
      if (!cur || cur.by !== by) {
        this.blue[x] = { by, since: core.time, penalised: false };
        core.emit({ type: 'flag', t: core.time, flag: 'blue', on: true, car: x, by });
      } else if (!cur.penalised && core.time - cur.since > rules.blueWindow) {
        cur.penalised = true;
        core.penalise(x, 'blueFlags', rules.bluePenalty);
      }
    }
  }

  getState(): FlagsState {
    return {
      slowSince: this.slowSince.slice(),
      until: this.until.slice(),
      on: this.on.slice(),
      blue: this.blue.map((b) => (b ? { ...b } : null)),
      greenAt: this.greenAt,
    };
  }

  setState(s: FlagsState): void {
    this.greenAt = s.greenAt;
    this.slowSince = s.slowSince.slice();
    this.until = s.until.slice();
    this.on = s.on.slice();
    this.blue = s.blue.map((b) => (b ? { ...b } : null));
  }
}
