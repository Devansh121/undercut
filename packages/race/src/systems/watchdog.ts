import type { RaceCore, RaceSystem } from '../core';
import type { AnomalyKind } from '../events';

/**
 * The stuck-car watchdog: the definition of a stuck car used by the product's acceptance test.
 * Only cars that are racing are watched (after lights out or the green, not finished, not
 * retired) and never while the pit system holds them (garage, box, penalty, service, waiting
 * for release). A car is flagged:
 *
 * - `stationary`: slower than `stuckSpeed` for `stuckTime`;
 * - `noProgress`: less than `progressDistance` of race distance gained over the last
 *   `progressTime` (a rolling window over position samples every 0.25 s, so slow creeping,
 *   stop-start crawling and rocking back and forth are all caught); the finding runs from the
 *   start of the first window that fell short and lasts while every window falls short;
 * - `offTrack`: all four wheels past the line, outside the pit lane, for `offTrackTime`;
 * - `wrongWay`: race distance falling faster than `wrongWaySpeed` for `wrongWayTime`.
 *
 * A car stationary or making no progress for `retireStuckAfter` (from the onset) is retired,
 * except a human driver in time trial or practice: they keep the warning and can reset.
 */
export interface Anomaly {
  car: number;
  kind: AnomalyKind;
  start: number;
  end: number | null;
}

const KINDS: readonly AnomalyKind[] = ['stationary', 'noProgress', 'offTrack', 'wrongWay'];
const STATIONARY = 0;
const NO_PROGRESS = 1;
const OFF_TRACK = 2;
const WRONG_WAY = 3;
/** Spacing of the progress samples, s. */
const SAMPLE = 0.25;

interface WatchCar {
  /** Onset times; NaN when not running (numbers only, so ticks do not allocate). */
  slowSince: number;
  offSince: number;
  wrongSince: number;
  lowSince: number;
  watchStart: number;
  /** Open finding start per kind (KINDS order), NaN when none. */
  active: Float64Array;
  /** Ring of (time, race distance) samples. */
  ringT: Float64Array;
  ringD: Float64Array;
  head: number;
  count: number;
}

export interface WatchdogState {
  cars: {
    slowSince: number | null;
    offSince: number | null;
    wrongSince: number | null;
    lowSince: number | null;
    watchStart: number | null;
    active: (number | null)[];
    ringT: number[];
    ringD: number[];
    head: number;
    count: number;
  }[];
  log: Anomaly[];
}

const toJson = (v: number): number | null => (Number.isNaN(v) ? null : v);
const fromJson = (v: number | null): number => (v === null ? Number.NaN : v);

export class Watchdog implements RaceSystem<WatchdogState> {
  private cars: WatchCar[];
  private log: Anomaly[] = [];
  private readonly isHeld: (car: number) => boolean;
  private readonly size: number;

  constructor(count: number, isHeld: (car: number) => boolean, progressTime = 10) {
    this.size = Math.ceil(progressTime / SAMPLE) + 3;
    this.cars = Array.from({ length: count }, () => this.fresh());
    this.isHeld = isHeld;
  }

  private fresh(): WatchCar {
    return {
      slowSince: Number.NaN,
      offSince: Number.NaN,
      wrongSince: Number.NaN,
      lowSince: Number.NaN,
      watchStart: Number.NaN,
      active: new Float64Array(4).fill(Number.NaN),
      ringT: new Float64Array(this.size),
      ringD: new Float64Array(this.size),
      head: 0,
      count: 0,
    };
  }

  /** Every anomaly so far, open ones with `end: null`. */
  anomalies(): readonly Anomaly[] {
    return this.log;
  }

  /** The car was moved (reset, restart, teleport): close its findings and start watching afresh. */
  resetCar(core: RaceCore, car: number): void {
    const w = this.cars[car]!;
    this.closeAll(core, car, w);
    this.forget(w);
  }

  private forget(w: WatchCar): void {
    w.slowSince = Number.NaN;
    w.offSince = Number.NaN;
    w.wrongSince = Number.NaN;
    w.lowSince = Number.NaN;
    w.watchStart = Number.NaN;
    w.count = 0;
    w.head = 0;
  }

  tick(core: RaceCore): void {
    const r = core.rules;
    const t = core.time;
    const dt = core.time - core.prevTime;
    const kind = core.strategy.kind;
    for (let k = 0; k < this.cars.length; k++) {
      const i = core.order[k]!;
      const w = this.cars[i]!;
      const f = core.facts[i]!;
      const car = core.cars[i]!;
      if (!core.racing(i) || this.isHeld(i)) {
        this.closeAll(core, i, w);
        this.forget(w);
        continue;
      }
      if (Number.isNaN(w.watchStart)) w.watchStart = t;
      // Stationary.
      if (f.speed < r.stuckSpeed) {
        if (Number.isNaN(w.slowSince)) w.slowSince = t;
      } else w.slowSince = Number.NaN;
      this.set(
        core,
        i,
        w,
        STATIONARY,
        !Number.isNaN(w.slowSince) && t - w.slowSince >= r.stuckTime,
        w.slowSince,
      );
      // Progress over a rolling window.
      this.sample(w, t, car.dist);
      let low = false;
      if (t - w.watchStart >= r.progressTime) {
        const then = this.distanceAt(w, t - r.progressTime);
        low = car.dist - then < r.progressDistance;
      }
      if (low) {
        if (Number.isNaN(w.lowSince)) w.lowSince = t - r.progressTime;
      } else w.lowSince = Number.NaN;
      this.set(core, i, w, NO_PROGRESS, low, w.lowSince);
      // Off track.
      if (f.wheelsOff >= 4 && !f.inPitLane) {
        if (Number.isNaN(w.offSince)) w.offSince = t;
      } else w.offSince = Number.NaN;
      this.set(
        core,
        i,
        w,
        OFF_TRACK,
        !Number.isNaN(w.offSince) && t - w.offSince >= r.offTrackTime,
        w.offSince,
      );
      // Wrong way.
      const rate = dt > 0 ? (car.dist - car.prevDist) / dt : 0;
      if (rate < -r.wrongWaySpeed) {
        if (Number.isNaN(w.wrongSince)) w.wrongSince = t;
      } else w.wrongSince = Number.NaN;
      this.set(
        core,
        i,
        w,
        WRONG_WAY,
        !Number.isNaN(w.wrongSince) && t - w.wrongSince >= r.wrongWayTime,
        w.wrongSince,
      );
      // Retire a car stuck for too long (never a person in time trial or practice).
      const mayRetire = !(core.human(i) && (kind === 'timeTrial' || kind === 'practice'));
      if (r.retireStuckAfter !== null && mayRetire) {
        const a = w.active[STATIONARY]!;
        const b = w.active[NO_PROGRESS]!;
        const since = Number.isNaN(a) ? b : Number.isNaN(b) ? a : Math.min(a, b);
        if (!Number.isNaN(since) && t - since >= r.retireStuckAfter) {
          core.retire(i, 'stuck');
          this.closeAll(core, i, w);
          this.forget(w);
        }
      }
    }
  }

  private sample(w: WatchCar, t: number, dist: number): void {
    if (w.count > 0) {
      const last = (w.head + w.count - 1) % this.size;
      if (t - w.ringT[last]! < SAMPLE) return;
    }
    if (w.count === this.size) {
      w.head = (w.head + 1) % this.size;
      w.count -= 1;
    }
    const k = (w.head + w.count) % this.size;
    w.ringT[k] = t;
    w.ringD[k] = dist;
    w.count += 1;
  }

  /** Race distance of the newest sample at or before `time` (the oldest kept if none is). */
  private distanceAt(w: WatchCar, time: number): number {
    let d = w.ringD[w.head]!;
    for (let j = 0; j < w.count; j++) {
      const k = (w.head + j) % this.size;
      if (w.ringT[k]! > time) break;
      d = w.ringD[k]!;
    }
    return d;
  }

  private set(
    core: RaceCore,
    car: number,
    w: WatchCar,
    kind: number,
    on: boolean,
    since: number,
  ): void {
    const active = w.active[kind]!;
    if (on && Number.isNaN(active)) {
      const start = Number.isNaN(since) ? core.time : since;
      w.active[kind] = start;
      this.log.push({ car, kind: KINDS[kind]!, start, end: null });
      core.emit({
        type: 'anomaly',
        t: core.time,
        car,
        kind: KINDS[kind]!,
        on: true,
        duration: core.time - start,
      });
    } else if (!on && !Number.isNaN(active)) {
      this.close(core, car, w, kind);
    }
  }

  private close(core: RaceCore, car: number, w: WatchCar, kind: number): void {
    const start = w.active[kind]!;
    if (Number.isNaN(start)) return;
    w.active[kind] = Number.NaN;
    for (let k = this.log.length - 1; k >= 0; k--) {
      const a = this.log[k]!;
      if (a.car === car && a.kind === KINDS[kind] && a.end === null) {
        a.end = core.time;
        break;
      }
    }
    core.emit({
      type: 'anomaly',
      t: core.time,
      car,
      kind: KINDS[kind]!,
      on: false,
      duration: core.time - start,
    });
  }

  private closeAll(core: RaceCore, car: number, w: WatchCar): void {
    for (let k = 0; k < 4; k++) if (!Number.isNaN(w.active[k]!)) this.close(core, car, w, k);
  }

  getState(): WatchdogState {
    return {
      cars: this.cars.map((w) => ({
        slowSince: toJson(w.slowSince),
        offSince: toJson(w.offSince),
        wrongSince: toJson(w.wrongSince),
        lowSince: toJson(w.lowSince),
        watchStart: toJson(w.watchStart),
        active: Array.from(w.active, toJson),
        ringT: Array.from(w.ringT),
        ringD: Array.from(w.ringD),
        head: w.head,
        count: w.count,
      })),
      log: this.log.map((a) => ({ ...a })),
    };
  }

  setState(s: WatchdogState): void {
    this.cars = s.cars.map((c) => ({
      slowSince: fromJson(c.slowSince),
      offSince: fromJson(c.offSince),
      wrongSince: fromJson(c.wrongSince),
      lowSince: fromJson(c.lowSince),
      watchStart: fromJson(c.watchStart),
      active: Float64Array.from(c.active.map(fromJson)),
      ringT: Float64Array.from(c.ringT),
      ringD: Float64Array.from(c.ringD),
      head: c.head,
      count: c.count,
    }));
    this.log = s.log.map((a) => ({ ...a }));
  }
}
