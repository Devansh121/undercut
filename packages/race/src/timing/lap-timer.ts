/**
 * Lap and sector timing for one car. Pure: fed the car's track position `s` and the sim time
 * at the start and end of every tick, it finds each line crossing inside the tick by linear
 * interpolation, so times resolve to well under a millisecond even though a tick is 4.2 ms.
 *
 * Once a lap is running the timer follows the car's distance along the lap (the signed change
 * of `s` each tick, summed), and a line counts only when that distance first reaches it. So:
 * - a car that backs over a line and drives forward again does not cross it twice;
 * - several lines inside one tick are all found, in order;
 * - a car in the pit lane (whose `s` is its projection onto the lap) crosses the lines too;
 * - a jump in `s` between ticks (a reset to the track) moves the distance without crossing.
 *
 * Delta classes, as the HUD colours them:
 * - `overall` (purple): faster than the best of anyone (in time trial, the stored record);
 * - `personal` (green): this car's best of the session, but not the overall best;
 * - `slower` (yellow): slower than this car's best;
 * - `invalid` (red): on a lap that was invalidated.
 */

export type DeltaClass = 'overall' | 'personal' | 'slower' | 'invalid';

/** Where the lines are: lap length and the s of each sector's start line (the first is the timing line). */
export interface TimingLines {
  readonly length: number;
  readonly sectors: ArrayLike<number>;
}

/** Best times, lap and per sector, in seconds. Null where none is set yet. */
export interface TimingBests {
  lap: number | null;
  sectors: (number | null)[];
}

export interface LapResult {
  /** 1-based lap number. */
  lap: number;
  time: number;
  sectors: number[];
  sectorClasses: DeltaClass[];
  valid: boolean;
  class: DeltaClass;
  /** Against this car's best lap before this one; null when there was none. */
  deltaToBest: number | null;
  /** New best of this car in this session. */
  personalBest: boolean;
  /** New overall best (in time trial: a new record for the circuit). */
  record: boolean;
  /** Per sector, a new overall best for that sector (from any valid lap, lap record or not). */
  sectorRecords: boolean[];
}

export type TimingEvent =
  | { type: 'lapStart'; lap: number; time: number }
  | {
      type: 'sector';
      lap: number;
      index: number;
      /** Sector time, s. */
      time: number;
      /** Sim time of the crossing. */
      at: number;
      class: DeltaClass;
      /** Against the same sector of this car's best lap; null without one. */
      delta: number | null;
    }
  | { type: 'lap'; at: number; result: LapResult };

/**
 * Fraction in (0, 1] of a tick from `prevS` to `curS` at which a forward move crosses `lineS`,
 * or null when it does not. Starting exactly on the line does not count as crossing it;
 * landing exactly on it does. Moves of half a lap or more are not forward moves.
 */
export function crossingFraction(
  length: number,
  prevS: number,
  curS: number,
  lineS: number,
): number | null {
  const travelled = forward(length, prevS, curS);
  if (travelled <= 0 || travelled >= length / 2) return null;
  const toLine = forward(length, prevS, lineS);
  if (toLine <= 0 || toLine > travelled) return null;
  return toLine / travelled;
}

function forward(length: number, from: number, to: number): number {
  const d = (to - from) % length;
  return d < 0 ? d + length : d;
}

/** Signed shortest move from `from` to `to` on a loop, in (-length/2, length/2]. */
export function lapDelta(length: number, from: number, to: number): number {
  const f = forward(length, from, to);
  return f > length / 2 ? f - length : f;
}

function emptyBests(count: number): TimingBests {
  return { lap: null, sectors: Array.from({ length: count }, () => null) };
}

/** Everything a timer remembers, as plain data (snapshots). */
export interface LapTimerState {
  personal: TimingBests;
  bestLapSectors: number[] | null;
  running: boolean;
  synced: boolean;
  lastS: number;
  dist: number;
  lapBase: number;
  lap: number;
  lapStart: number;
  sector: number;
  sectorStart: number;
  sectorTimes: number[];
  sectorClasses: DeltaClass[];
  valid: boolean;
  lastLap: number | null;
}

export class LapTimer {
  readonly lines: TimingLines;
  /**
   * The overall bests this car is compared with and contributes to: in time trial the record
   * kept on this device, in a multi-car session one object shared by every car's timer.
   * Updated in place as they fall.
   */
  readonly record: TimingBests;
  /** This car's bests in this session. */
  readonly session: TimingBests;
  /** Distance of each sector line after the timing line, m; the last entry is the lap length. */
  private readonly lineDist: number[];
  private bestLapSectors: number[] | null = null;
  private runningValue = false;
  private synced = false;
  private lastS = 0;
  private dist = 0;
  private lapBase = 0;
  private lapValue = 0;
  private lapStart = 0;
  private sectorValue = 0;
  private sectorStart = 0;
  private sectorTimes: number[] = [];
  private sectorClasses: DeltaClass[] = [];
  private validValue = true;
  private lastLapValue: number | null = null;

  /**
   * `record`: stored all-time bests to compare against (copied). `shared`: an overall-bests
   * object to use as is, shared with other timers; it wins over `record`.
   */
  constructor(lines: TimingLines, record?: TimingBests, shared?: TimingBests) {
    this.lines = lines;
    const count = lines.sectors.length;
    if (count < 1) throw new RangeError('a timer needs at least the timing line');
    const t0 = lines.sectors[0] as number;
    this.lineDist = [];
    for (let k = 1; k < count; k++) {
      this.lineDist.push(forward(lines.length, t0, lines.sectors[k] as number));
    }
    this.lineDist.push(lines.length);
    this.record =
      shared ??
      (record
        ? {
            lap: record.lap,
            sectors: Array.from({ length: count }, (_, i) => record.sectors[i] ?? null),
          }
        : emptyBests(count));
    this.session = emptyBests(count);
  }

  get running(): boolean {
    return this.runningValue;
  }

  /** Lap in progress, 1-based; 0 before the first crossing of the line. */
  get lap(): number {
    return this.lapValue;
  }

  /** Laps completed at the line (0 before the first one). */
  get lapsCompleted(): number {
    return this.runningValue ? this.lapValue - 1 : 0;
  }

  /** Sector in progress, 0-based. */
  get sector(): number {
    return this.sectorValue;
  }

  get valid(): boolean {
    return this.validValue;
  }

  get bestLap(): number | null {
    return this.session.lap;
  }

  get lastLap(): number | null {
    return this.lastLapValue;
  }

  /**
   * Distance along the lap from the start of lap 1, m: the race distance. Before the first
   * crossing it is negative (metres to go to the line); meaningless until the first update.
   */
  get distance(): number {
    return this.dist;
  }

  /** Distance covered on the current lap, m (0 before the first crossing). */
  get lapDistance(): number {
    return this.runningValue ? this.dist - this.lapBase : 0;
  }

  /** Sector times so far on the current lap, and their classes. */
  get currentSectors(): readonly number[] {
    return this.sectorTimes;
  }

  get currentSectorClasses(): readonly DeltaClass[] {
    return this.sectorClasses;
  }

  /** Best lap's sector times, or null. */
  get bestSectors(): readonly number[] | null {
    return this.bestLapSectors;
  }

  /** Sim time at which the current lap began. */
  get lapStartTime(): number {
    return this.lapStart;
  }

  currentLapTime(now: number): number {
    return this.runningValue ? Math.max(0, now - this.lapStart) : 0;
  }

  /** The current lap no longer counts for bests (track limits, a reset). */
  invalidate(): void {
    this.validValue = false;
  }

  /** Back to before the first crossing; bests are kept. The next update re-reads the position. */
  restart(): void {
    this.runningValue = false;
    this.synced = false;
    this.lapValue = 0;
    this.lapBase = 0;
    this.sectorValue = 0;
    this.sectorTimes = [];
    this.sectorClasses = [];
    this.validValue = true;
  }

  /**
   * A standing start: lap 1 begins now, at sim time `at`, with the car at lap position `s`
   * (on the grid, possibly ahead of or behind the timing line). Its first lap ends at the line.
   */
  startAt(at: number, s: number): void {
    const { length } = this.lines;
    const t0 = this.lines.sectors[0] as number;
    this.synced = true;
    this.lastS = s;
    this.dist = lapDelta(length, t0, s);
    this.beginLap(at, 1, 0);
    // Lines already behind the car on lap 1 (a grid far past the timing line) are skipped.
    while (
      this.sectorValue < this.lineDist.length - 1 &&
      this.lineDist[this.sectorValue]! <= this.dist
    )
      this.sectorValue++;
  }

  /** One tick: the car moved from prevS at prevT to curS at curT. */
  update(prevS: number, curS: number, prevT: number, curT: number): TimingEvent[] {
    const events: TimingEvent[] = [];
    const { length } = this.lines;
    const t0 = this.lines.sectors[0] as number;
    if (!this.synced) {
      this.synced = true;
      this.lastS = prevS;
      this.dist = forward(length, t0, prevS) - length;
    } else if (prevS !== this.lastS) {
      // The car was moved between ticks: carry the distance, cross nothing.
      this.dist += lapDelta(length, this.lastS, prevS);
    }
    this.lastS = curS;
    const before = this.dist;
    const moved = lapDelta(length, prevS, curS);
    this.dist = before + moved;

    let from = before;
    if (!this.runningValue) {
      const f = crossingFraction(length, prevS, curS, t0);
      if (f === null) return events;
      const t = prevT + f * (curT - prevT);
      // Re-anchor: the line is distance 0 of lap 1.
      from = 0;
      this.dist = forward(length, t0, curS);
      if (this.dist >= length / 2) this.dist -= length;
      this.beginLap(t, 1, 0);
      events.push({ type: 'lapStart', lap: 1, time: t });
      if (this.dist <= 0) return events;
    }
    // Every line from the car's next one up to its distance now, in order.
    const to = this.dist;
    for (let guard = 0; guard < 64; guard++) {
      const line = this.lapBase + this.lineDist[this.sectorValue]!;
      if (!(line > from && line <= to)) break;
      const f = (line - before) / (to - before);
      const t = prevT + Math.min(1, Math.max(0, f)) * (curT - prevT);
      this.crossLine(t, events);
      from = line;
    }
    return events;
  }

  private crossLine(t: number, events: TimingEvent[]): void {
    const time = t - this.sectorStart;
    const index = this.sectorValue;
    const cls = this.classifySector(index, time);
    const ref = this.bestLapSectors?.[index];
    this.sectorTimes.push(time);
    this.sectorClasses.push(cls);
    events.push({
      type: 'sector',
      lap: this.lapValue,
      index,
      time,
      at: t,
      class: cls,
      delta: ref === undefined ? null : time - ref,
    });
    if (index + 1 < this.lineDist.length) {
      this.sectorValue = index + 1;
      this.sectorStart = t;
      return;
    }
    events.push({ type: 'lap', at: t, result: this.finishLap(t) });
    // The next lap starts here; the 'lap' event stands for its start (no separate lapStart).
    this.beginLap(t, this.lapValue + 1, this.lapBase + this.lines.length);
  }

  private beginLap(t: number, lap: number, base: number): void {
    this.runningValue = true;
    this.lapValue = lap;
    this.lapBase = base;
    this.lapStart = t;
    this.sectorStart = t;
    this.sectorValue = 0;
    this.sectorTimes = [];
    this.sectorClasses = [];
    this.validValue = true;
  }

  private classifySector(index: number, time: number): DeltaClass {
    if (!this.validValue) return 'invalid';
    return classify(time, this.record.sectors[index] ?? null, this.session.sectors[index] ?? null);
  }

  private finishLap(t: number): LapResult {
    const time = t - this.lapStart;
    const valid = this.validValue;
    const previousBest = this.session.lap;
    const cls: DeltaClass = valid ? classify(time, this.record.lap, previousBest) : 'invalid';
    const sectors = this.sectorTimes.slice();
    const complete = sectors.length === this.lineDist.length;
    const result: LapResult = {
      lap: this.lapValue,
      time,
      sectors,
      sectorClasses: this.sectorClasses.slice(),
      valid,
      class: cls,
      deltaToBest: previousBest === null ? null : time - previousBest,
      personalBest: valid && (previousBest === null || time < previousBest),
      record: valid && (this.record.lap === null || time < this.record.lap),
      sectorRecords: sectors.map((s, i) => {
        const best = this.record.sectors[i] ?? null;
        return valid && complete && (best === null || s < best);
      }),
    };
    this.lastLapValue = time;
    if (valid) {
      if (complete) {
        sectors.forEach((s, i) => {
          if (this.session.sectors[i] === null || s < (this.session.sectors[i] as number))
            this.session.sectors[i] = s;
          if (this.record.sectors[i] === null || s < (this.record.sectors[i] as number))
            this.record.sectors[i] = s;
        });
      }
      if (result.personalBest) {
        this.session.lap = time;
        this.bestLapSectors = complete ? sectors : null;
      }
      if (result.record) this.record.lap = time;
    }
    return result;
  }

  getState(): LapTimerState {
    return {
      personal: { lap: this.session.lap, sectors: this.session.sectors.slice() },
      bestLapSectors: this.bestLapSectors ? this.bestLapSectors.slice() : null,
      running: this.runningValue,
      synced: this.synced,
      lastS: this.lastS,
      dist: this.dist,
      lapBase: this.lapBase,
      lap: this.lapValue,
      lapStart: this.lapStart,
      sector: this.sectorValue,
      sectorStart: this.sectorStart,
      sectorTimes: this.sectorTimes.slice(),
      sectorClasses: this.sectorClasses.slice(),
      valid: this.validValue,
      lastLap: this.lastLapValue,
    };
  }

  setState(s: LapTimerState): void {
    this.session.lap = s.personal.lap;
    this.session.sectors.splice(0, this.session.sectors.length, ...s.personal.sectors);
    this.bestLapSectors = s.bestLapSectors ? s.bestLapSectors.slice() : null;
    this.runningValue = s.running;
    this.synced = s.synced;
    this.lastS = s.lastS;
    this.dist = s.dist;
    this.lapBase = s.lapBase;
    this.lapValue = s.lap;
    this.lapStart = s.lapStart;
    this.sectorValue = s.sector;
    this.sectorStart = s.sectorStart;
    this.sectorTimes = s.sectorTimes.slice();
    this.sectorClasses = s.sectorClasses.slice();
    this.validValue = s.valid;
    this.lastLapValue = s.lastLap;
  }
}

function classify(time: number, record: number | null, session: number | null): DeltaClass {
  if (record === null || time < record) return 'overall';
  if (session === null || time < session) return 'personal';
  return 'slower';
}
