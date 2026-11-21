export interface FixedStepOptions {
  /** Simulation step in seconds, for example 1 / 240. */
  step: number;
  /**
   * Longest frame time accepted, in seconds. A longer gap (tab in the background,
   * debugger pause, GC stall) is clamped to this so the sim never tries to catch up
   * on minutes of time in one frame. Defaults to 0.25 s.
   */
  maxFrameTime?: number;
}

/**
 * Turns variable frame times into a whole number of fixed simulation steps plus an
 * interpolation factor for rendering between the previous and current sim state.
 *
 *     const steps = acc.advance(frameSeconds);
 *     for (let i = 0; i < steps; i++) stepSim(acc.step);
 *     render(previous, current, acc.alpha);
 */
export class FixedStepAccumulator {
  readonly step: number;
  readonly maxFrameTime: number;
  private accumulated = 0;

  constructor({ step, maxFrameTime = 0.25 }: FixedStepOptions) {
    if (!(step > 0) || !Number.isFinite(step)) throw new RangeError('step must be > 0');
    if (!(maxFrameTime >= step)) throw new RangeError('maxFrameTime must be >= step');
    this.step = step;
    this.maxFrameTime = maxFrameTime;
  }

  /** Add elapsed wall time in seconds; returns how many fixed steps to run now. */
  advance(elapsedSeconds: number): number {
    const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
    this.accumulated += Math.min(elapsed, this.maxFrameTime);
    // A tiny tolerance keeps 0.1 / 0.01 from coming out as 9 steps and a 0.99999 remainder.
    const steps = Math.floor(this.accumulated / this.step + 1e-9);
    this.accumulated = Math.max(0, this.accumulated - steps * this.step);
    return steps;
  }

  /** Fraction of a step left over, in [0, 1): the render interpolation factor. */
  get alpha(): number {
    return Math.min(this.accumulated / this.step, 1 - Number.EPSILON);
  }

  /** Drop any accumulated time, for example after loading or a pause. */
  reset(): void {
    this.accumulated = 0;
  }
}
