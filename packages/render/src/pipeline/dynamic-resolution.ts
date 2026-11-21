/**
 * Dynamic resolution: scales the canvas's drawing buffer (never the DOM HUD) to hold a frame-time
 * target. Pure logic, fed one frame time per frame.
 *
 * - A smoothed frame time (exponential, ~0.5 s) is compared with the target. Single stalls longer
 *   than four targets (a tab switch, a shader compile) are ignored.
 * - Over the target for 0.5 s: step the scale down in proportion to the excess (cost is assumed to
 *   follow pixel count, so scale goes as the square root of the time ratio), at most 15 % a step.
 * - Under 75 % of the target for 1.5 s: step up by the headroom to 80 % of the target, at most
 *   10 % a step. The asymmetry (fast down, slow up, a wide dead
 *   band) stops it hunting between two sizes, which would show as shimmer.
 * - Scales snap to 1/40 steps so the drawing buffer size, and its render targets, change rarely.
 */
export interface DynamicResolutionOptions {
  /** Target frame time, ms; 0 turns the controller off. */
  targetMs: number;
  /** Lowest scale. */
  min: number;
}

const STEP = 1 / 40;

export class DynamicResolution {
  scale = 1;
  private smoothed = 0;
  private over = 0;
  private under = 0;

  constructor(private readonly options: DynamicResolutionOptions) {}

  /** Feed the last frame's time; returns true when the scale changed. */
  update(frameMs: number): boolean {
    const target = this.options.targetMs;
    if (target <= 0 || frameMs <= 0) return false;
    if (frameMs > target * 4) return false;
    const k = 1 - Math.exp(-frameMs / 500);
    this.smoothed = this.smoothed === 0 ? frameMs : this.smoothed + (frameMs - this.smoothed) * k;
    const before = this.scale;
    if (this.smoothed > target * 1.04) {
      this.over += frameMs;
      this.under = 0;
      if (this.over > 500) {
        const ratio = Math.sqrt(target / this.smoothed) * 0.98;
        const next = Math.max(this.scale * Math.max(0.85, ratio), this.options.min);
        this.set(Math.floor(next / STEP) * STEP);
        this.over = 0;
        // Expect the next frames to be cheaper: restart the average near the target.
        this.smoothed = target;
      }
    } else if (this.smoothed < target * 0.75) {
      this.under += frameMs;
      this.over = 0;
      if (this.under > 1500 && this.scale < 1) {
        const ratio = Math.min(1.1, Math.sqrt((0.8 * target) / this.smoothed));
        this.set(Math.min(1, Math.ceil((this.scale * ratio) / STEP) * STEP));
        this.under = 0;
        // Expect dearer frames: assume the new size costs the ratio more.
        this.smoothed *= ratio * ratio;
      }
    } else {
      this.over = 0;
      this.under = 0;
    }
    return this.scale !== before;
  }

  private set(v: number): void {
    this.scale = Math.min(1, Math.max(this.options.min, v));
  }

  reset(): void {
    this.scale = 1;
    this.smoothed = 0;
    this.over = 0;
    this.under = 0;
  }
}
