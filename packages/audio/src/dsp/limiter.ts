import {
  INTERPOLATOR_DELAY,
  INTERPOLATOR_MAX_GAIN,
  OVERSAMPLE,
  POLYPHASE,
  TAPS_PER_PHASE,
} from './oversampling';

/**
 * Master-bus protection: a look-ahead true-peak limiter followed by a soft-knee clipper.
 *
 * The detector measures true peak: each input sample and the four points the 4× interpolator
 * (the same one the true-peak meter uses) places around it, so overshoots between samples
 * count. The limiter is exact on that measure: the gain for each delayed sample is the
 * moving average, over the look-ahead window, of a sliding minimum of the gain every sample
 * in that window needs. Every value in that average is at most the gain the peak needs, so
 * the delayed peak lands at or under `threshold` with no overshoot, and the gain itself moves
 * smoothly.
 * The interpolator costs 128 multiply-adds per stereo sample, so it only runs when it could
 * matter: when the largest input magnitude in a block (and in the history the interpolator
 * still reads) times the interpolator's largest gain cannot exceed `threshold`, every true peak
 * in that block is under it, the gain needed is exactly 1, and the detector is skipped. The
 * output is identical either way; in normal driving the master bus sits well under the bound.
 * The clipper after it is the identity below `knee` and approaches `ceiling` asymptotically,
 * so no sample can reach `ceiling` whatever the input.
 */
export interface LimiterOptions {
  /** Peak level the limiter holds, linear. */
  threshold: number;
  /** Where the clipper starts to bend, linear. */
  knee: number;
  /** Level the clipper never reaches, linear. */
  ceiling: number;
  /** Look-ahead, s. Also the limiter's latency. */
  lookahead: number;
  /** Gain recovery time constant, s. */
  release: number;
}

export const DEFAULT_LIMITER: LimiterOptions = {
  threshold: 0.84, // -1.5 dBFS
  knee: 0.86,
  ceiling: 0.944, // -0.5 dBFS
  lookahead: 0.0015,
  release: 0.12,
};

export class SoftLimiter {
  private readonly size: number;
  private readonly delayL: Float64Array;
  private readonly delayR: Float64Array;
  private readonly avgRing: Float64Array;
  private readonly minIndex: Int32Array;
  private readonly minValue: Float64Array;
  private readonly delay: number = 0;
  /** Last TAPS_PER_PHASE inputs per channel, stored twice so a window is contiguous. */
  private readonly histL = new Float64Array(2 * TAPS_PER_PHASE);
  private readonly histR = new Float64Array(2 * TAPS_PER_PHASE);
  private hpos = 0;
  private readonly poly: Float64Array = POLYPHASE;
  private readonly taps: number = TAPS_PER_PHASE;
  private readonly phases: number = OVERSAMPLE;
  private readonly lag: number = INTERPOLATOR_DELAY;
  private dpos = 0;
  private head = 0;
  private tail = 0;
  private pos = 0;
  private n = 0;
  private sum = 0;
  private env = 1;
  /** Consecutive samples written to `avgRing` at exactly 1 (counted up to `size`). */
  private onesRun = 0;
  private readonly kRelease: number;
  /** Lowest gain applied since the last read, for metering. */
  minGain = 1;

  constructor(
    sampleRate: number,
    private readonly opts: LimiterOptions = DEFAULT_LIMITER,
  ) {
    this.size = Math.max(1, Math.round(opts.lookahead * sampleRate));
    // The detector sees a sample INTERPOLATOR_DELAY samples after it arrives; from then a
    // peak is covered by every average for the next `size` samples, so it is read out
    // `size - 1` samples after that, under the lowest of them.
    this.delay = this.size - 1 + INTERPOLATOR_DELAY;
    this.delayL = new Float64Array(Math.max(1, this.delay));
    this.delayR = new Float64Array(Math.max(1, this.delay));
    this.avgRing = new Float64Array(this.size).fill(1);
    this.minIndex = new Int32Array(this.size + 1);
    this.minValue = new Float64Array(this.size + 1);
    this.sum = this.size;
    this.onesRun = this.size;
    this.kRelease = 1 - Math.exp(-1 / (opts.release * sampleRate));
  }

  /** Latency in frames. */
  get latency(): number {
    return this.delay;
  }

  /** Process stereo in place. */
  process(left: Float64Array, right: Float64Array, frames: number): void {
    const { threshold, knee, ceiling } = this.opts;
    const room = ceiling - knee;
    // Module constants into locals: imported bindings can be slow to read in a hot loop.
    const poly = this.poly;
    const taps = this.taps;
    const phases = this.phases;
    const lag = this.lag;
    const size = this.size;
    const cap = size + 1;
    const hl = this.histL;
    const hr = this.histR;
    // Largest magnitude any detection in this block reads: the history and the new samples.
    // A NaN sticks (no comparison with it is true) and sends the block to the full detector.
    let bound = 0;
    for (let t = 0; t < taps; t++) {
      const a = Math.abs(hl[t] as number);
      const b = Math.abs(hr[t] as number);
      if (a > bound || a !== a) bound = a;
      if (b > bound || b !== b) bound = b;
    }
    for (let i = 0; i < frames; i++) {
      const a = Math.abs(left[i] as number);
      const b = Math.abs(right[i] as number);
      if (a > bound || a !== a) bound = a;
      if (b > bound || b !== b) bound = b;
    }
    const quiet = bound * INTERPOLATOR_MAX_GAIN <= threshold;
    // At rest (gain exactly 1, the average window all ones, the minimum queue holding one 1)
    // a quiet block leaves the gain at exactly 1 on every sample: only the delay runs.
    if (
      quiet &&
      this.env === 1 &&
      this.sum === size &&
      this.onesRun >= size &&
      this.tail === (this.head + 1) % cap &&
      this.minValue[this.head] === 1
    ) {
      this.processAtRest(left, right, frames);
      return;
    }
    for (let i = 0; i < frames; i++) {
      const l = left[i] as number;
      const r = right[i] as number;
      // True-peak detection for the sample INTERPOLATOR_DELAY behind the newest.
      const hp = this.hpos;
      hl[hp] = l;
      hl[hp + taps] = l;
      hr[hp] = r;
      hr[hp + taps] = r;
      this.hpos = hp + 1 === taps ? 0 : hp + 1;
      let need = 1;
      if (!quiet) {
        // Newest sample at hp + taps; x[n - t] at hp + taps - t.
        const newest = hp + taps;
        let peak = Math.abs(hl[newest - lag] as number);
        const pr = Math.abs(hr[newest - lag] as number);
        if (pr > peak) peak = pr;
        for (let ph = 0; ph < phases; ph++) {
          const base = ph * taps;
          let al = 0;
          let ar = 0;
          for (let t = 0; t < taps; t++) {
            const c = poly[base + t] as number;
            al += c * (hl[newest - t] as number);
            ar += c * (hr[newest - t] as number);
          }
          if (al < 0) al = -al;
          if (ar < 0) ar = -ar;
          if (al > peak) peak = al;
          if (ar > peak) peak = ar;
        }
        need = peak > threshold ? threshold / peak : 1;
      }

      // Sliding minimum over the last `size` samples (monotonic deque in a ring).
      while (this.head !== this.tail) {
        const back = (this.tail - 1 + cap) % cap;
        if ((this.minValue[back] as number) >= need) this.tail = back;
        else break;
      }
      this.minIndex[this.tail] = this.n;
      this.minValue[this.tail] = need;
      this.tail = (this.tail + 1) % cap;
      while ((this.minIndex[this.head] as number) <= this.n - size)
        this.head = (this.head + 1) % cap;
      const hold = this.minValue[this.head] as number;

      // Instant attack to the held minimum, smooth release, never above it.
      this.env = hold < this.env ? hold : this.env + (hold - this.env) * this.kRelease;

      // Moving average over the same window.
      this.sum += this.env - (this.avgRing[this.pos] as number);
      this.avgRing[this.pos] = this.env;
      if (this.env !== 1) this.onesRun = 0;
      else if (this.onesRun < size) this.onesRun++;
      const gain = Math.min(1, this.sum / size);
      if (gain < this.minGain) this.minGain = gain;

      let dl = l;
      let dr = r;
      if (this.delay > 0) {
        dl = this.delayL[this.dpos] as number;
        dr = this.delayR[this.dpos] as number;
        this.delayL[this.dpos] = l;
        this.delayR[this.dpos] = r;
        this.dpos = this.dpos + 1 === this.delay ? 0 : this.dpos + 1;
      }
      this.pos = this.pos + 1 === size ? 0 : this.pos + 1;
      this.n++;
      if (this.pos === 0) {
        // Re-sum once per window so rounding never drifts.
        let s = 0;
        for (let k = 0; k < size; k++) s += this.avgRing[k] as number;
        this.sum = s;
      }
      // The soft clip, written out (see `softClip`) so this loop calls nothing.
      let yl = dl * gain;
      let yr = dr * gain;
      const al = yl < 0 ? -yl : yl;
      if (al > knee) {
        const c = knee + room * Math.tanh((al - knee) / room);
        yl = yl < 0 ? -c : c;
      }
      const ar = yr < 0 ? -yr : yr;
      if (ar > knee) {
        const c = knee + room * Math.tanh((ar - knee) / room);
        yr = yr < 0 ? -c : c;
      }
      left[i] = yl;
      right[i] = yr;
    }
  }

  /**
   * `process` for a quiet block at rest: the same state changes and output as the full loop
   * when every sample needs a gain of 1 (the queue's one entry moves to the newest sample,
   * the envelope, average and sum stay at exactly 1 and `size`), without the arithmetic.
   */
  private processAtRest(left: Float64Array, right: Float64Array, frames: number): void {
    const { knee, ceiling } = this.opts;
    const room = ceiling - knee;
    const taps = this.taps;
    const size = this.size;
    const hl = this.histL;
    const hr = this.histR;
    const delay = this.delay;
    const dlL = this.delayL;
    const dlR = this.delayR;
    let hpos = this.hpos;
    let dpos = this.dpos;
    for (let i = 0; i < frames; i++) {
      const l = left[i] as number;
      const r = right[i] as number;
      hl[hpos] = l;
      hl[hpos + taps] = l;
      hr[hpos] = r;
      hr[hpos + taps] = r;
      hpos = hpos + 1 === taps ? 0 : hpos + 1;
      let yl = l;
      let yr = r;
      if (delay > 0) {
        yl = dlL[dpos] as number;
        yr = dlR[dpos] as number;
        dlL[dpos] = l;
        dlR[dpos] = r;
        dpos = dpos + 1 === delay ? 0 : dpos + 1;
      }
      // The delayed samples can predate this quiet block, so the clipper still applies.
      const al = yl < 0 ? -yl : yl;
      if (al > knee) {
        const c = knee + room * Math.tanh((al - knee) / room);
        yl = yl < 0 ? -c : c;
      }
      const ar = yr < 0 ? -yr : yr;
      if (ar > knee) {
        const c = knee + room * Math.tanh((ar - knee) / room);
        yr = yr < 0 ? -c : c;
      }
      left[i] = yl;
      right[i] = yr;
    }
    this.hpos = hpos;
    this.dpos = dpos;
    this.n += frames;
    this.pos = (this.pos + frames) % size;
    // The queue's single entry now stands for the newest sample.
    this.minIndex[this.head] = this.n - 1;
  }
}

/** Identity below `knee`; above it, bends smoothly towards `ceiling` and never reaches it. */
export function softClip(x: number, knee: number, ceiling: number): number {
  const a = x < 0 ? -x : x;
  if (a <= knee) return x;
  const room = ceiling - knee;
  const y = knee + room * Math.tanh((a - knee) / room);
  return x < 0 ? -y : y;
}
