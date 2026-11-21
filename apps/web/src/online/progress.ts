/**
 * Race laps of the local car from its position along the lap: what the rooms service counts.
 * A lap is a forward crossing of the timing line. Positions are measured from that line, as
 * the snapshots and lap claims carry them (`s` in [0, length), `lap` completed laps).
 *
 * - A grid behind the timing line owes one crossing: the pass at the start is not a lap.
 * - Reversing over the line owes a crossing, so going back and forth never earns a lap.
 * - A placement (reset to track, teleport) is never a crossing: the next sample starts afresh.
 * - A step that moves more than a quarter of a lap is a jump, not driving, and is not a crossing.
 *
 * Pure: no clock; sim times come in with each sample.
 */

export interface LineCounterOptions {
  /** Lap length along the centreline, m. */
  length: number;
  /** Track s of the timing line, m. */
  timingLine: number;
  /** Track s the car starts from (its grid slot), m. */
  startS: number;
}

export interface Crossing {
  /** The lap just completed (1 for the first). */
  lap: number;
  /** Sim time of the crossing, s, interpolated between the two samples around it. */
  time: number;
}

export class LineCounter {
  private readonly length: number;
  private readonly line: number;
  private readonly window: number;
  private prev: { s: number; time: number } | null = null;
  private lapsValue = 0;
  private debt: number;

  constructor(o: LineCounterOptions) {
    this.length = o.length;
    this.line = o.timingLine;
    this.window = o.length / 4;
    this.debt = this.lineS(o.startS) > o.length / 2 ? 1 : 0;
  }

  /** Distance from the timing line along the lap, in [0, length). */
  lineS(trackS: number): number {
    const L = this.length;
    const s = (trackS - this.line) % L;
    return s < 0 ? s + L : s;
  }

  /** Laps completed. */
  get laps(): number {
    return this.lapsValue;
  }

  /** Laps already counted (a resumed seat). */
  setLaps(laps: number): void {
    this.lapsValue = Math.max(0, Math.floor(laps));
    this.debt = 0;
  }

  /** The car was placed rather than driven to `trackS`. */
  placed(trackS: number, time: number): void {
    this.prev = { s: this.lineS(trackS), time };
  }

  /** A new sample of the car's track s at sim time `time`. Returns the lap it completes, if any. */
  update(trackS: number, time: number): Crossing | null {
    const s = this.lineS(trackS);
    const prev = this.prev;
    this.prev = { s, time };
    if (!prev) return null;
    const L = this.length;
    const w = this.window;
    if (prev.s > L - w && s < w) {
      if (this.debt > 0) {
        this.debt--;
        return null;
      }
      const before = L - prev.s;
      const f = before + s > 0 ? before / (before + s) : 1;
      this.lapsValue++;
      return { lap: this.lapsValue, time: prev.time + f * (time - prev.time) };
    }
    if (prev.s < w && s > L - w) this.debt++;
    return null;
  }
}
