/**
 * Lap and sector timing. Pure: fed the car's track position `s` and the sim time at the start
 * and end of every tick, it finds each line crossing inside the tick by linear interpolation,
 * so times resolve to well under a millisecond even though a tick is 4.2 ms.
 *
 * Delta classes, as the HUD colours them:
 * - `overall` (purple): faster than the all-time best on this circuit, loaded from storage;
 * - `personal` (green): the best of this session, but not an all-time best;
 * - `slower` (yellow): slower than this session's best;
 * - `invalid` (red): on a lap that was invalidated.
 * In time trial there is one driver, so "overall" means the record kept on this device.
 */

export type DeltaClass = 'overall' | 'personal' | 'slower' | 'invalid';

/** Where the lines are: lap length and the start s of each sector (the first is 0). */
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
  /** Against the session's best lap before this one; null when there was none. */
  deltaToBest: number | null;
  /** New best of this session. */
  personalBest: boolean;
  /** New all-time best for the circuit. */
  record: boolean;
  /** Per sector, a new all-time best for that sector (from any valid lap, lap record or not). */
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
      /** Against the same sector of the best lap; null without one. */
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

function emptyBests(count: number): TimingBests {
  return { lap: null, sectors: Array.from({ length: count }, () => null) };
}

export class LapTimer {
  readonly lines: TimingLines;
  /** All-time bests for the circuit; updated in place as they fall. */
  readonly record: TimingBests;
  /** Bests of this session. */
  readonly session: TimingBests;
  /** Sector times of the session's best lap, for sector deltas. */
  private bestLapSectors: number[] | null = null;
  private runningValue = false;
  private lapValue = 0;
  private lapStart = 0;
  private sectorValue = 0;
  private sectorStart = 0;
  private sectorTimes: number[] = [];
  private sectorClasses: DeltaClass[] = [];
  private validValue = true;
  private lastLapValue: number | null = null;

  constructor(lines: TimingLines, record?: TimingBests) {
    this.lines = lines;
    const count = lines.sectors.length;
    this.record = record
      ? {
          lap: record.lap,
          sectors: Array.from({ length: count }, (_, i) => record.sectors[i] ?? null),
        }
      : emptyBests(count);
    this.session = emptyBests(count);
  }

  get running(): boolean {
    return this.runningValue;
  }

  /** Lap in progress, 1-based; 0 before the first crossing of the line. */
  get lap(): number {
    return this.lapValue;
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

  /** Back to before the first crossing; bests are kept. */
  restart(): void {
    this.runningValue = false;
    this.lapValue = 0;
    this.sectorValue = 0;
    this.sectorTimes = [];
    this.sectorClasses = [];
    this.validValue = true;
  }

  /** One tick: the car moved from prevS at prevT to curS at curT. */
  update(prevS: number, curS: number, prevT: number, curT: number): TimingEvent[] {
    const events: TimingEvent[] = [];
    const { length, sectors } = this.lines;
    const count = sectors.length;
    const at = (lineS: number): number | null => {
      const f = crossingFraction(length, prevS, curS, lineS);
      return f === null ? null : prevT + f * (curT - prevT);
    };

    if (!this.runningValue) {
      const t = at(sectors[0] ?? 0);
      if (t === null) return events;
      this.beginLap(t, 1);
      events.push({ type: 'lapStart', lap: 1, time: t });
      return events;
    }

    // At most one line per tick: sector lines are hundreds of metres apart.
    const next = (this.sectorValue + 1) % count;
    const t = at(sectors[next] ?? 0);
    if (t === null) return events;
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
    if (next !== 0) {
      this.sectorValue = next;
      this.sectorStart = t;
      return events;
    }
    events.push({ type: 'lap', at: t, result: this.finishLap(t) });
    this.beginLap(t, this.lapValue + 1);
    return events;
  }

  private beginLap(t: number, lap: number): void {
    this.runningValue = true;
    this.lapValue = lap;
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
      sectorRecords: sectors.map((t, i) => {
        const best = this.record.sectors[i] ?? null;
        return valid && (best === null || t < best);
      }),
    };
    this.lastLapValue = time;
    if (valid) {
      sectors.forEach((s, i) => {
        if (this.session.sectors[i] === null || s < (this.session.sectors[i] as number))
          this.session.sectors[i] = s;
        if (this.record.sectors[i] === null || s < (this.record.sectors[i] as number))
          this.record.sectors[i] = s;
      });
      if (result.personalBest) {
        this.session.lap = time;
        this.bestLapSectors = sectors;
      }
      if (result.record) this.record.lap = time;
    }
    return result;
  }
}

function classify(time: number, record: number | null, session: number | null): DeltaClass {
  if (record === null || time < record) return 'overall';
  if (session === null || time < session) return 'personal';
  return 'slower';
}
