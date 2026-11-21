import { inRange, type RaceCore, type RaceSystem } from '../core';

/**
 * Track limits. The limit is the outer edge of the white line; a lap is invalid when all four
 * wheels are wholly beyond it at once. What an excursion costs depends on the session:
 *
 * - time trial and practice: the lap is invalid;
 * - qualifying: the lap time is deleted, and the next lap too when the excursion is in the last
 *   corner (between its start and the timing line), whose exit speed carries into that lap;
 * - race: each excursion is a strike. Strikes 1 to 3 are warnings (the third with the black and
 *   white flag), the fourth is a time penalty, and the count repeats (7th black and white, 8th
 *   penalty, ...). An excursion that gains a place must give it back within `giveBackWindow`,
 *   or it costs `cutPenalty`. A place counts as gained off track if it is taken while the car
 *   is off or within `cutTrailTime` after it rejoins. A place still owed when the car takes the
 *   flag is penalised there, before the classification. Lasting time gained without a place
 *   changing is covered by the lap invalidation and the strike count, not judged separately.
 *
 * The reading is the car at the end of each tick. When a timing line falls inside the same tick
 * as a four-off reading, which came first is unknown, so it counts against both laps.
 */
interface LimitsCar {
  off: boolean;
  /** Time the car last came back inside (for the re-arm delay); null until the first excursion. */
  onSince: number | null;
  strikes: number;
  deleteNext: boolean;
  /** Places taken while off (or just after) are owed back until then; null when no excursion is live. */
  cutUntil: number | null;
  owed: { car: number; deadline: number }[];
}

export interface LimitsState {
  cars: LimitsCar[];
}

export class LimitsSystem implements RaceSystem<LimitsState> {
  private cars: LimitsCar[];

  constructor(count: number) {
    this.cars = Array.from({ length: count }, () => ({
      off: false,
      onSince: null,
      strikes: 0,
      deleteNext: false,
      cutUntil: null,
      owed: [],
    }));
  }

  /** Strikes so far (race). */
  strikes(car: number): number {
    return this.cars[car]!.strikes;
  }

  /** All four wheels off at the end of this tick. */
  offNow(car: number): boolean {
    return this.cars[car]!.off;
  }

  /** Before the timing lines: invalidate, count strikes. */
  tick(core: RaceCore): void {
    const { rules, strategy, circuit } = core;
    for (let k = 0; k < this.cars.length; k++) {
      const i = core.order[k]!;
      const c = this.cars[i]!;
      const f = core.facts[i]!;
      const active =
        core.cars[i]!.status === 'running' && core.phase !== 'grid' && core.phase !== 'lights';
      const off = active && !f.inPitLane && f.wheelsOff >= rules.wheelsOffForInvalid;
      if (off) core.invalidate(i, 'limits');
      if (off && !c.off) {
        const rearmed = c.onSince === null || core.time - c.onSince >= rules.limitsRearm;
        if (rearmed) this.excursion(core, i, c);
        if (strategy.limits === 'race') c.cutUntil = Infinity;
      }
      if (!off && c.off) {
        c.onSince = core.time;
        if (c.cutUntil !== null) c.cutUntil = core.time + rules.cutTrailTime;
      }
      c.off = off;
      if (c.cutUntil !== null && core.time > c.cutUntil) c.cutUntil = null;
      if (strategy.limits === 'qualifying' && off) {
        if (inRange(circuit.length, f.s, circuit.lastCornerStart, circuit.timingLine)) {
          c.deleteNext = true;
        }
      }
    }
  }

  private excursion(core: RaceCore, car: number, c: LimitsCar): void {
    if (core.strategy.limits !== 'race') return;
    const per = core.rules.strikesPerPenalty;
    c.strikes += 1;
    const n = c.strikes;
    const outcome = n % per === 0 ? 'penalty' : n % per === per - 1 ? 'blackWhite' : 'warning';
    core.emit({ type: 'trackLimits', t: core.time, car, strike: n, outcome });
    if (outcome === 'blackWhite') {
      core.emit({ type: 'flag', t: core.time, flag: 'blackWhite', on: true, car });
    } else if (outcome === 'penalty') {
      core.penalise(car, 'trackLimits', core.rules.limitsPenalty);
    }
  }

  /** After a timing line: a four-off reading in this tick also counts against the new lap. */
  onLine(core: RaceCore, car: number): void {
    const c = this.cars[car]!;
    if (c.off) core.invalidate(car, 'limits');
    if (c.deleteNext) {
      c.deleteNext = false;
      core.invalidate(car, 'deleted');
    }
  }

  /**
   * The car takes the flag at race distance `dist`, at sim time `at`: every place it still owes
   * to a car behind it on the road at that moment (not finished, still running; positions
   * interpolated inside the tick) is settled now, as a penalty, before the classification. A
   * place taken in this very tick while off track counts too.
   */
  atFinish(core: RaceCore, car: number, dist: number, at: number): void {
    if (core.strategy.limits !== 'race') return;
    const c = this.cars[car]!;
    const me = core.cars[car]!;
    // Where another car was at the moment this one crossed the line: its distance interpolated
    // inside the tick, like the crossing itself (its end-of-tick distance may already be past
    // the line in a close finish).
    const span = core.time - core.prevTime;
    const f = span > 0 ? Math.min(1, Math.max(0, (at - core.prevTime) / span)) : 1;
    const distAt = (j: number): number => {
      const o = core.cars[j]!;
      return o.prevDist + (o.dist - o.prevDist) * f;
    };
    if (c.cutUntil !== null) {
      for (let k = 0; k < core.order.length; k++) {
        const j = core.order[k]!;
        if (j === car || !core.racing(j) || core.facts[j]!.inPitLane) continue;
        const other = core.cars[j]!;
        if (me.prevDist < other.prevDist && dist > distAt(j) && !c.owed.some((o) => o.car === j)) {
          c.owed.push({ car: j, deadline: core.time });
        }
      }
    }
    for (const o of c.owed) {
      const other = core.cars[o.car]!;
      // A car that took the flag earlier (this tick included) is ahead: the place was given back.
      if (other.status === 'running' && other.finishTime === null && distAt(o.car) < dist) {
        core.penalise(car, 'leavingTrack', core.rules.cutPenalty);
      }
    }
    c.owed = [];
  }

  /** After positions: places gained off track, owed back or penalised. */
  afterPositions(core: RaceCore): void {
    if (core.strategy.limits !== 'race') return;
    for (let k = 0; k < this.cars.length; k++) {
      const i = core.order[k]!;
      const c = this.cars[i]!;
      const me = core.cars[i]!;
      if (me.status !== 'running') {
        c.owed = [];
        continue;
      }
      if (c.cutUntil !== null && core.racing(i)) {
        for (let q = 0; q < this.cars.length; q++) {
          const j = core.order[q]!;
          if (j === i || !core.racing(j) || core.facts[j]!.inPitLane) continue;
          const other = core.cars[j]!;
          if (me.prevDist < other.prevDist && me.dist > other.dist) {
            if (!c.owed.some((o) => o.car === j)) {
              c.owed.push({ car: j, deadline: core.time + core.rules.giveBackWindow });
            }
          }
        }
      }
      if (c.owed.length === 0) continue;
      c.owed = c.owed.filter((o) => {
        const other = core.cars[o.car]!;
        if (other.status !== 'running' || other.finishTime !== null) return false;
        if (me.dist < other.dist) return false; // given back
        if (core.time > o.deadline) {
          core.penalise(i, 'leavingTrack', core.rules.cutPenalty);
          return false;
        }
        return true;
      });
    }
  }

  getState(): LimitsState {
    return {
      cars: this.cars.map((c) => ({
        ...c,
        cutUntil: c.cutUntil === Infinity ? -1 : c.cutUntil,
        owed: c.owed.map((o) => ({ ...o })),
      })),
    };
  }

  setState(s: LimitsState): void {
    this.cars = s.cars.map((c) => ({
      ...c,
      cutUntil: c.cutUntil === -1 ? Infinity : c.cutUntil,
      owed: c.owed.map((o) => ({ ...o })),
    }));
  }
}
