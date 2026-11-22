/**
 * Dynamic resolution: scales the canvas's drawing buffer (never the DOM HUD) to hold a frame-time
 * target. Pure logic, fed one frame time per frame.
 *
 * - The first 60 samples after a start or `reset` (a teleport, a restart) are ignored: loading
 *   and first-use stalls are not load.
 * - A smoothed frame time (exponential, ~0.5 s) is compared with the target. An isolated frame
 *   longer than four targets (a tab switch, a shader compile) is ignored; three or more in a row
 *   are overload, and count (capped at eight targets each) like any slow frame.
 * - Over the target for 0.5 s: step the scale down in proportion to the excess (cost is assumed to
 *   follow pixel count, so scale goes as the square root of the time ratio), at most 15 % a step.
 * - Under 75 % of the target for 1.5 s: step up by the headroom to 80 % of the target, at most
 *   10 % a step. The asymmetry (fast down, slow up, a wide dead
 *   band) stops it hunting between two sizes, which would show as shimmer.
 * - Scales snap to 1/40 steps so the drawing buffer size, and its render targets, change rarely.
 * - Above the preset's cap (`max` > 1, for a phone whose screen has more pixels than the cap):
 *   measured headroom climbs as above. With only a vsync-capped frame interval (no GPU timer, as
 *   on iPhone Safari) headroom cannot be measured, so it probes: after 3 s held at the target it
 *   steps up 10 %. A probe that misses the target steps back down at once and becomes the ceiling
 *   for 30 s (doubling after each miss), so a phone never hunts visibly.
 */
export interface DynamicResolutionOptions {
  /** Target frame time, ms; 0 turns the controller off. */
  targetMs: number;
  /** Lowest scale. */
  min: number;
  /** Highest scale; above 1 the drawing buffer may exceed the preset's pixel-ratio cap. */
  max?: number;
}

const STEP = 1 / 40;
const WARMUP = 60;
/** Time held at the target before probing a larger size, ms. */
const HOLD = 3000;
const PROBE = 0.1;
const HOLD_OFF = 30000;

export class DynamicResolution {
  scale = 1;
  private smoothed = 0;
  private over = 0;
  private under = 0;
  /** Consecutive frames over four targets. */
  private stalls = 0;
  /** Samples still to ignore after a start or reset. */
  private warmup = WARMUP;
  private held = 0;
  /** Running time from the samples, ms. */
  private clock = 0;
  /** The scale a probe started from, until the probe has held. */
  private probedFrom: number | null = null;
  private ceiling = Infinity;
  private ceilingUntil = 0;
  private misses = 0;

  constructor(private readonly options: DynamicResolutionOptions) {}

  /** Feed the last frame's time; returns true when the scale changed. */
  update(frameMs: number): boolean {
    const target = this.options.targetMs;
    if (target <= 0 || frameMs <= 0) return false;
    if (this.warmup > 0) {
      this.warmup--;
      return false;
    }
    if (frameMs > target * 4) {
      this.stalls++;
      if (this.stalls < 3) return false;
      frameMs = Math.min(frameMs, target * 8);
    } else {
      this.stalls = 0;
    }
    this.clock += frameMs;
    if (this.clock > this.ceilingUntil) this.ceiling = Infinity;
    const top = Math.min(this.options.max ?? 1, this.ceiling);
    const k = 1 - Math.exp(-frameMs / 500);
    this.smoothed = this.smoothed === 0 ? frameMs : this.smoothed + (frameMs - this.smoothed) * k;
    const before = this.scale;
    if (this.smoothed > target * 1.04) {
      this.over += frameMs;
      this.under = 0;
      this.held = 0;
      if (this.over > 500) {
        if (this.probedFrom !== null) {
          // The larger size missed: it is the ceiling for a while, longer after each miss.
          this.ceiling = this.probedFrom;
          this.ceilingUntil = this.clock + HOLD_OFF * 2 ** Math.min(this.misses, 4);
          this.misses++;
          this.probedFrom = null;
        }
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
      this.held = 0;
      this.probedFrom = null;
      if (this.under > 1500 && this.scale < top) {
        const ratio = Math.min(1.1, Math.sqrt((0.8 * target) / this.smoothed));
        this.set(Math.min(top, Math.ceil((this.scale * ratio) / STEP) * STEP));
        this.under = 0;
        // Expect dearer frames: assume the new size costs the ratio more.
        this.smoothed *= ratio * ratio;
      }
    } else {
      this.over = 0;
      this.under = 0;
      this.held += frameMs;
      if (this.held > HOLD) {
        // Held at the target: a probe that got here has passed; try the next size above the cap.
        this.held = 0;
        this.probedFrom = null;
        if (this.scale >= 1 && this.scale < top) {
          this.probedFrom = this.scale;
          this.set(Math.min(top, Math.ceil((this.scale + PROBE) / STEP) * STEP));
        }
      }
    }
    return this.scale !== before;
  }

  private set(v: number): void {
    this.scale = Math.min(this.options.max ?? 1, Math.max(this.options.min, v));
  }

  reset(): void {
    this.scale = 1;
    this.smoothed = 0;
    this.over = 0;
    this.under = 0;
    this.stalls = 0;
    this.warmup = WARMUP;
    this.held = 0;
    this.probedFrom = null;
  }

  /** Start ignoring samples again (after a teleport or restart), keeping the current scale. */
  rewarm(): void {
    this.warmup = WARMUP;
    this.smoothed = 0;
    this.over = 0;
    this.under = 0;
    this.stalls = 0;
    this.held = 0;
    this.probedFrom = null;
  }
}
