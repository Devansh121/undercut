/** Filter shapes, from the RBJ "Audio EQ Cookbook". Bandpass has 0 dB gain at the centre. */
export const BiquadKind = {
  Lowpass: 0,
  Highpass: 1,
  Bandpass: 2,
  Peaking: 3,
  HighShelf: 4,
} as const;
export type BiquadKind = (typeof BiquadKind)[keyof typeof BiquadKind];

/**
 * Second-order IIR section in transposed direct form II. Coefficients can be changed while
 * running; the state carries over, so a slow sweep does not click. No allocation after
 * construction.
 *
 * To retune on the audio thread, write `frequency` (and `q`, `gainDb`) and call `design()`.
 * Passing fractional numbers as call arguments can make the JavaScript engine box them, so
 * the hot path never does; the chainable setters are for construction.
 */
export class Biquad {
  kind: BiquadKind = BiquadKind.Lowpass as BiquadKind;
  frequency = 1000;
  q = 0.7071;
  gainDb = 0;
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  private readonly sampleRate: number = 48_000;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  /** Clear the filter memory. Only call while the filter's output is muted. */
  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  /** Filter one sample. For analysis and tests; the audio path uses `processBlock`. */
  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /**
   * Filter `n` samples of `input` into `output` (which may be the same array). Works on
   * locals and typed arrays only, so it never boxes a number.
   */
  processBlock(input: Float64Array, output: Float64Array, n: number): void {
    this.processRange(input, output, 0, n);
  }

  /** Like `processBlock`, over indices [start, end). */
  processRange(input: Float64Array, output: Float64Array, start: number, end: number): void {
    const b0 = this.b0;
    const b1 = this.b1;
    const b2 = this.b2;
    const a1 = this.a1;
    const a2 = this.a2;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = start; i < end; i++) {
      const x = input[i] as number;
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      output[i] = y;
    }
    // Inputs are validated upstream; if a non-finite value got in anyway, do not let it live
    // on in the filter memory (x - x is NaN for NaN and for ±Infinity).
    if (z1 - z1 !== 0 || z2 - z2 !== 0) {
      z1 = 0;
      z2 = 0;
    }
    this.z1 = z1;
    this.z2 = z2;
  }

  lowpass(frequency: number, q: number): this {
    return this.configure(BiquadKind.Lowpass, frequency, q, 0);
  }

  highpass(frequency: number, q: number): this {
    return this.configure(BiquadKind.Highpass, frequency, q, 0);
  }

  bandpass(frequency: number, q: number): this {
    return this.configure(BiquadKind.Bandpass, frequency, q, 0);
  }

  peaking(frequency: number, q: number, gainDb: number): this {
    return this.configure(BiquadKind.Peaking, frequency, q, gainDb);
  }

  highShelf(frequency: number, q: number, gainDb: number): this {
    return this.configure(BiquadKind.HighShelf, frequency, q, gainDb);
  }

  private configure(kind: BiquadKind, frequency: number, q: number, gainDb: number): this {
    this.kind = kind;
    this.frequency = frequency;
    this.q = q;
    this.gainDb = gainDb;
    this.design();
    return this;
  }

  /** Recompute the coefficients from `kind`, `frequency`, `q` and `gainDb`. */
  design(): void {
    // Keep the design inside (0, Nyquist) whatever the caller asks for.
    let f = this.frequency;
    const fMax = this.sampleRate * 0.49;
    f = f < 1 ? 1 : f > fMax ? fMax : f;
    const w = (2 * Math.PI * f) / this.sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * this.q);
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    switch (this.kind) {
      case BiquadKind.Lowpass:
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case BiquadKind.Highpass:
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case BiquadKind.Bandpass:
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cos;
        a2 = 1 - alpha;
        break;
      case BiquadKind.Peaking: {
        const a = Math.pow(10, this.gainDb / 40);
        b0 = 1 + alpha * a;
        b1 = -2 * cos;
        b2 = 1 - alpha * a;
        a0 = 1 + alpha / a;
        a1 = -2 * cos;
        a2 = 1 - alpha / a;
        break;
      }
      default: {
        const a = Math.pow(10, this.gainDb / 40);
        const s = 2 * Math.sqrt(a) * alpha;
        b0 = a * (a + 1 + (a - 1) * cos + s);
        b1 = -2 * a * (a - 1 + (a + 1) * cos);
        b2 = a * (a + 1 + (a - 1) * cos - s);
        a0 = a + 1 - (a - 1) * cos + s;
        a1 = 2 * (a - 1 - (a + 1) * cos);
        a2 = a + 1 - (a - 1) * cos - s;
      }
    }
    const inv = 1 / a0;
    this.b0 = b0 * inv;
    this.b1 = b1 * inv;
    this.b2 = b2 * inv;
    this.a1 = a1 * inv;
    this.a2 = a2 * inv;
  }
}

/** One-pole low-pass used for control smoothing: y += (x - y) * k. */
export function onePoleCoefficient(timeConstant: number, sampleRate: number): number {
  if (timeConstant <= 0) return 1;
  return 1 - Math.exp(-1 / (timeConstant * sampleRate));
}
