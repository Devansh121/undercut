export interface BackoffOptions {
  initialMs: number;
  maxMs: number;
  factor: number;
  /** Fraction of each delay randomised (spread reconnects of many clients). */
  jitter: number;
  /** Give up after this many attempts in a row. */
  maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  initialMs: 250,
  maxMs: 5000,
  factor: 2,
  jitter: 0.25,
  maxAttempts: 30,
};

/** Exponential backoff with jitter. */
export class Backoff {
  private attempt = 0;

  constructor(
    private readonly options: BackoffOptions,
    private readonly random: () => number,
  ) {}

  get attempts(): number {
    return this.attempt;
  }

  get exhausted(): boolean {
    return this.attempt >= this.options.maxAttempts;
  }

  /** Delay before the next attempt, ms. */
  next(): number {
    const o = this.options;
    const base = Math.min(o.maxMs, o.initialMs * o.factor ** this.attempt);
    this.attempt++;
    return Math.round(base * (1 - o.jitter + 2 * o.jitter * this.random()));
  }

  reset(): void {
    this.attempt = 0;
  }
}
