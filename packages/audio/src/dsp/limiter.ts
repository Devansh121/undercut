/**
 * Master-bus protection: a look-ahead peak limiter followed by a soft-knee clipper.
 *
 * The limiter is exact: the gain for each delayed sample is the moving average, over the
 * look-ahead window, of a sliding minimum of the gain every sample in that window needs.
 * Every value in that average is at most the gain the peak needs, so the delayed peak lands
 * at or under `threshold` with no overshoot, and the gain itself moves smoothly.
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
  private dpos = 0;
  private head = 0;
  private tail = 0;
  private pos = 0;
  private n = 0;
  private sum = 0;
  private env = 1;
  private readonly kRelease: number;
  /** Lowest gain applied since the last read, for metering. */
  minGain = 1;

  constructor(
    sampleRate: number,
    private readonly opts: LimiterOptions = DEFAULT_LIMITER,
  ) {
    this.size = Math.max(1, Math.round(opts.lookahead * sampleRate));
    // A peak entering now is covered by every average for the next `size` samples, so it
    // is read out `size - 1` samples later, under the lowest of them.
    this.delay = this.size - 1;
    this.delayL = new Float64Array(Math.max(1, this.delay));
    this.delayR = new Float64Array(Math.max(1, this.delay));
    this.avgRing = new Float64Array(this.size).fill(1);
    this.minIndex = new Int32Array(this.size + 1);
    this.minValue = new Float64Array(this.size + 1);
    this.sum = this.size;
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
    const size = this.size;
    const cap = size + 1;
    for (let i = 0; i < frames; i++) {
      const l = left[i] as number;
      const r = right[i] as number;
      const peak = Math.max(Math.abs(l), Math.abs(r));
      const need = peak > threshold ? threshold / peak : 1;

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
}

/** Identity below `knee`; above it, bends smoothly towards `ceiling` and never reaches it. */
export function softClip(x: number, knee: number, ceiling: number): number {
  const a = x < 0 ? -x : x;
  if (a <= knee) return x;
  const room = ceiling - knee;
  const y = knee + room * Math.tanh((a - knee) / room);
  return x < 0 ? -y : y;
}
