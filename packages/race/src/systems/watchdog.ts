import type { RaceCore, RaceSystem } from '../core';
import type { AnomalyKind } from '../events';

/**
 * The stuck-car watchdog: the definition of a stuck car used by the product's acceptance test.
 * Only cars that are racing are watched (after lights out or the green, not finished, not
 * retired) and never while the pit system holds them in their box or garage. A car is flagged:
 *
 * - `stationary`: slower than `stuckSpeed` for `stuckTime`;
 * - `noProgress`: less than `progressDistance` of race distance gained in `progressTime`;
 * - `offTrack`: all four wheels past the line, outside the pit lane, for `offTrackTime`;
 * - `wrongWay`: race distance falling faster than `wrongWaySpeed` for `wrongWayTime`.
 *
 * A stuck car (stationary or making no progress) for `retireStuckAfter` is retired.
 */
export interface Anomaly {
  car: number;
  kind: AnomalyKind;
  start: number;
  end: number | null;
}

interface WatchCar {
  slowSince: number | null;
  offSince: number | null;
  wrongSince: number | null;
  refDist: number;
  refTime: number;
  active: Record<AnomalyKind, number | null>;
}

export interface WatchdogState {
  cars: WatchCar[];
  log: Anomaly[];
}

const KINDS: readonly AnomalyKind[] = ['stationary', 'noProgress', 'offTrack', 'wrongWay'];

function fresh(): WatchCar {
  return {
    slowSince: null,
    offSince: null,
    wrongSince: null,
    refDist: Number.NaN,
    refTime: 0,
    active: { stationary: null, noProgress: null, offTrack: null, wrongWay: null },
  };
}

export class Watchdog implements RaceSystem<WatchdogState> {
  private cars: WatchCar[];
  private log: Anomaly[] = [];
  private readonly isHeld: (car: number) => boolean;

  constructor(count: number, isHeld: (car: number) => boolean) {
    this.cars = Array.from({ length: count }, fresh);
    this.isHeld = isHeld;
  }

  /** Every anomaly so far, open ones with `end: null`. */
  anomalies(): readonly Anomaly[] {
    return this.log;
  }

  tick(core: RaceCore): void {
    const r = core.rules;
    const t = core.time;
    const dt = core.time - core.prevTime;
    for (let i = 0; i < this.cars.length; i++) {
      const w = this.cars[i]!;
      const f = core.facts[i]!;
      const car = core.cars[i]!;
      if (!core.racing(i) || this.isHeld(i)) {
        this.closeAll(core, i, w);
        w.slowSince = null;
        w.offSince = null;
        w.wrongSince = null;
        w.refDist = car.dist;
        w.refTime = t;
        continue;
      }
      if (Number.isNaN(w.refDist)) {
        w.refDist = car.dist;
        w.refTime = t;
      }
      // Stationary.
      if (f.speed < r.stuckSpeed) w.slowSince ??= t;
      else w.slowSince = null;
      this.set(
        core,
        i,
        w,
        'stationary',
        w.slowSince !== null && t - w.slowSince >= r.stuckTime,
        w.slowSince,
      );
      // Progress.
      if (car.dist > w.refDist + r.progressDistance) {
        w.refDist = car.dist;
        w.refTime = t;
      }
      this.set(core, i, w, 'noProgress', t - w.refTime >= r.progressTime, w.refTime);
      // Off track.
      if (f.wheelsOff >= 4 && !f.inPitLane) w.offSince ??= t;
      else w.offSince = null;
      this.set(
        core,
        i,
        w,
        'offTrack',
        w.offSince !== null && t - w.offSince >= r.offTrackTime,
        w.offSince,
      );
      // Wrong way.
      const rate = dt > 0 ? (car.dist - car.prevDist) / dt : 0;
      if (rate < -r.wrongWaySpeed) w.wrongSince ??= t;
      else w.wrongSince = null;
      this.set(
        core,
        i,
        w,
        'wrongWay',
        w.wrongSince !== null && t - w.wrongSince >= r.wrongWayTime,
        w.wrongSince,
      );
      // Retire a car stuck for too long.
      if (r.retireStuckAfter !== null) {
        const since = Math.min(w.active.stationary ?? Infinity, w.active.noProgress ?? Infinity);
        if (since !== Infinity && t - since >= r.retireStuckAfter) {
          core.retire(i, 'stuck');
          this.closeAll(core, i, w);
        }
      }
    }
  }

  private set(
    core: RaceCore,
    car: number,
    w: WatchCar,
    kind: AnomalyKind,
    on: boolean,
    since: number | null,
  ): void {
    const active = w.active[kind];
    if (on && active === null) {
      const start = since ?? core.time;
      w.active[kind] = start;
      this.log.push({ car, kind, start, end: null });
      core.emit({
        type: 'anomaly',
        t: core.time,
        car,
        kind,
        on: true,
        duration: core.time - start,
      });
    } else if (!on && active !== null) {
      this.close(core, car, w, kind);
    }
  }

  private close(core: RaceCore, car: number, w: WatchCar, kind: AnomalyKind): void {
    const start = w.active[kind];
    if (start === null) return;
    w.active[kind] = null;
    for (let k = this.log.length - 1; k >= 0; k--) {
      const a = this.log[k]!;
      if (a.car === car && a.kind === kind && a.end === null) {
        a.end = core.time;
        break;
      }
    }
    core.emit({ type: 'anomaly', t: core.time, car, kind, on: false, duration: core.time - start });
  }

  private closeAll(core: RaceCore, car: number, w: WatchCar): void {
    for (const k of KINDS) if (w.active[k] !== null) this.close(core, car, w, k);
  }

  getState(): WatchdogState {
    return {
      cars: this.cars.map((w) => ({
        ...w,
        refDist: Number.isNaN(w.refDist) ? -1e12 : w.refDist,
        active: { ...w.active },
      })),
      log: this.log.map((a) => ({ ...a })),
    };
  }

  setState(s: WatchdogState): void {
    this.cars = s.cars.map((w) => ({
      ...w,
      refDist: w.refDist === -1e12 ? Number.NaN : w.refDist,
      active: { ...w.active },
    }));
    this.log = s.log.map((a) => ({ ...a }));
  }
}
