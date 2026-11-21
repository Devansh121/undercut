/**
 * Seeded white noise (xorshift32). Deterministic for a given seed and never touches
 * Math.random. The state lives in a typed array so that updating it never allocates.
 */
export class Noise {
  private readonly state = new Uint32Array(1);

  constructor(seed: number) {
    // xorshift32 has a fixed point at zero; any other seed is fine.
    this.state[0] = seed >>> 0 || 0x6d2b79f5;
  }

  private nextUint32(): number {
    let s = this.state[0] as number;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.state[0] = s;
    return this.state[0] as number;
  }

  /** Uniform in [-1, 1). RMS is 1/sqrt(3). For construction and tests. */
  bipolar(): number {
    return this.nextUint32() / 2147483648 - 1;
  }

  /** Uniform in [0, 1). For construction and tests. */
  unit(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Fill `n` samples of `out` with uniform noise in [-1, 1). */
  fill(out: Float64Array, n: number): void {
    let s = this.state[0] as number;
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      out[i] = s / 2147483648 - 1;
    }
    this.state[0] = s;
  }

  /** Fill the first `n` entries of `out` with uniform numbers in [0, 1). */
  draw(out: Float64Array, n: number): void {
    let s = this.state[0] as number;
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      out[i] = s / 4294967296;
    }
    this.state[0] = s;
  }
}
