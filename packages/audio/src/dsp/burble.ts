import { onePoleCoefficient } from './biquad';
import { Burst } from './burst';

/**
 * Overrun burble: what the exhaust does with the throttle shut at high revs.
 *
 * With the throttle closed the engine still turns fast, the charge in each cylinder is thin and
 * burns late or partly, and some of it lights in the exhaust. The result is an irregular,
 * lumpy exhaust note under the overrun, strongest just after the lift and fading as the revs
 * and the exhaust temperature fall. Two parts, both per firing event:
 *
 * - **Partial burns:** each event's pulse is scaled down by a random amount up to `DEPTH` of
 *   the burble strength, which roughens the note without changing its pitch.
 * - **Afterfire:** with a chance per event of up to `CHANCE` × strength, a low "blub" (a short
 *   noise burst through a 180–480 Hz resonance) on top. Lower and softer than the overrun pops.
 *
 * Strength is `overrun × (FLOOR + (1 − FLOOR) × freshness)`: `overrun` is how far the engine is
 * into the overrun (low load, revs above about 6000 rpm), `freshness` jumps to 1 on a lift and
 * decays over `FRESH_DECAY` seconds. Design values; nothing published measures this.
 */
export class OverrunBurble {
  static readonly DEPTH = 0.55;
  static readonly CHANCE = 0.2;
  static readonly FLOOR = 0.35;
  static readonly FRESH_DECAY = 1.8;
  /** Afterfire level, thousandths (integer: see `Burst.trigger`). */
  static readonly LEVEL_MILLI = 450;

  /** Burble strength now, 0–1. */
  strength = 0;
  /** Input for `tick`: how far into the overrun the engine is, 0–1. */
  overrun = 0;
  /** Output of `event`: the factor for that event's pulse level. */
  factor = 1;
  private fresh = 0;
  private readonly kFresh: number;
  private readonly kStrength: number;
  private readonly bursts: Burst[];
  private readonly ring: number;

  constructor(private readonly sampleRate: number) {
    this.kFresh = onePoleCoefficient(OverrunBurble.FRESH_DECAY, sampleRate);
    this.kStrength = onePoleCoefficient(0.05, sampleRate);
    this.bursts = [new Burst(sampleRate), new Burst(sampleRate)];
    this.ring = Math.round(sampleRate * 0.04);
  }

  /** The throttle was just lifted from high. */
  lift(): void {
    this.fresh = 1;
  }

  /**
   * Per sample, after setting `overrun`. Inputs and outputs go through fields so that calls on
   * the audio thread never pass or return a fractional number (V8 would box it).
   */
  tick(): void {
    this.fresh -= this.fresh * this.kFresh;
    const f = OverrunBurble.FLOOR;
    const target = this.overrun * (f + (1 - f) * this.fresh);
    this.strength += (target - this.strength) * this.kStrength;
    if (target === 0 && this.strength < 1e-6) this.strength = 0;
  }

  /**
   * One firing event at sample `at` of the chunk; `rnd[from..from+2]` are uniform in [0, 1).
   * Sets `factor` to the factor for this event's pulse level.
   */
  event(at: number, rnd: Float64Array, from: number): void {
    const s = this.strength;
    this.factor = 1;
    if (s === 0) return;
    const r0 = rnd[from] as number;
    const r1 = rnd[from + 1] as number;
    const r2 = rnd[from + 2] as number;
    if (r1 < OverrunBurble.CHANCE * s) {
      const b = (this.bursts[0] as Burst).activeAt(at)
        ? (this.bursts[1] as Burst)
        : (this.bursts[0] as Burst);
      b.trigger(
        at,
        Math.round(this.sampleRate * (0.003 + 0.004 * r2)),
        this.ring,
        Math.round(OverrunBurble.LEVEL_MILLI * s * (0.5 + 0.5 * r0)),
        Math.round(180 + 300 * r2),
        18,
      );
    }
    this.factor = 1 - OverrunBurble.DEPTH * s * r0;
  }

  /** Add the afterfire bursts for this chunk into `out`; their energy goes to `meter[slot]`. */
  renderAdd(
    noise: Float64Array,
    out: Float64Array,
    n: number,
    meter: Float64Array,
    slot: number,
  ): void {
    for (let b = 0; b < this.bursts.length; b++)
      (this.bursts[b] as Burst).renderAdd(noise, out, n, meter, slot);
  }
}
