import { onePoleCoefficient } from './biquad';
import { SINE_MASK, SINE_STEPS, SINE_TABLE } from './sine';
import type { GearboxSoundSpec } from './spec';

const TWO_PI = 2 * Math.PI;

/**
 * Transmission whine: the tooth-mesh tones of the engaged gear pair and of the final drive.
 *
 * Straight-cut racing gears whine at the mesh frequency, shaft speed times tooth count: the
 * input pinion of the engaged gear turns at crank speed (the clutch is closed; the drop gear is
 * folded into the ratio), and the final-drive pinion at output-shaft speed. Mesh tones are
 * loudest when the teeth unload and reload, so the level rises on the overrun and with speed,
 * and dips while a shift swaps the pairs over. Every partial fades out between 0.40 and 0.45 of
 * the sample rate, like the engine voice's whines, so none aliases.
 *
 * Phases accumulate continuously, so a gear change glides the tone to the new pair's pitch
 * over the shift instead of stepping. Allocation-free; per-sample work is a few multiplies and
 * three reads of the sine table.
 */
export class GearWhine {
  private readonly dt: number;
  private readonly invRef: number;
  private readonly fadeTop: number;
  private readonly fadeScale: number;
  private readonly kMesh: number;
  private readonly kLevel: number;
  private readonly teeth: Float64Array;
  private readonly overall: Float64Array;
  private readonly finalTeeth: number;
  private readonly finalRatio: number;
  private meshPhase = 0;
  private finalPhase = 0;
  private meshTeeth = 0;
  private gearRatio = 1;
  private level = 0;

  constructor(
    sampleRate: number,
    spec: GearboxSoundSpec,
    /** Engine speed that maps to full whine level, rad/s. */
    referenceSpeed: number,
    /** Peak level, linear. */
    private readonly peak: number,
  ) {
    this.dt = 1 / sampleRate;
    this.invRef = 1 / referenceSpeed;
    this.fadeTop = 0.45 * sampleRate;
    this.fadeScale = 1 / (0.05 * sampleRate);
    this.kMesh = onePoleCoefficient(spec.changeTime, sampleRate);
    this.kLevel = onePoleCoefficient(0.03, sampleRate);
    this.teeth = Float64Array.from(spec.pinionTeeth);
    this.overall = Float64Array.from(spec.gearRatios);
    this.finalTeeth = spec.finalPinionTeeth;
    this.finalRatio = spec.finalDrive;
    this.meshTeeth = this.teeth[0] as number;
    this.gearRatio = (this.overall[0] as number) / this.finalRatio;
  }

  /**
   * Write `n` samples into `out`. Inputs per sample: engine speed (rad/s), gear, load
   * (smoothed, 0–1), shifting (0 or 1), engine gate. Adds the layer's energy to `meter[slot]`.
   * Only integers and arrays cross the call, so V8 never boxes a number for it.
   */
  renderAdd(
    speed: Float64Array,
    gear: Float64Array,
    load: Float64Array,
    shifting: Float64Array,
    gate: Float64Array,
    out: Float64Array,
    n: number,
    meter: Float64Array,
    slot: number,
  ): void {
    const teeth = this.teeth;
    const overall = this.overall;
    const fadeTop = this.fadeTop;
    const fadeScale = this.fadeScale;
    const sine = SINE_TABLE;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const w = speed[i] as number;
      const gi = (gear[i] as number) | 0;
      const engaged = gi >= 1 && gi <= teeth.length;
      // The pair being meshed glides to the new gear's tooth count and ratio over the shift.
      const tTarget = engaged ? (teeth[gi - 1] as number) : this.meshTeeth;
      const rTarget = engaged ? (overall[gi - 1] as number) / this.finalRatio : this.gearRatio;
      this.meshTeeth += (tTarget - this.meshTeeth) * this.kMesh;
      this.gearRatio += (rTarget - this.gearRatio) * this.kMesh;
      const rev = w / TWO_PI;
      const fMesh = rev * this.meshTeeth;
      const fFinal = (rev / this.gearRatio) * this.finalTeeth;
      this.meshPhase += fMesh * this.dt;
      if (this.meshPhase >= 1) this.meshPhase -= Math.floor(this.meshPhase);
      this.finalPhase += fFinal * this.dt;
      if (this.finalPhase >= 1) this.finalPhase -= Math.floor(this.finalPhase);

      // Louder on the overrun (teeth unloading), with speed, quieter while the pairs change.
      let r = w * this.invRef;
      r = r > 1.1 ? 1.1 : r;
      const ld = load[i] as number;
      const target =
        (engaged ? 1 : 0) *
        (0.35 + 0.65 * (1 - ld)) *
        r *
        r *
        ((shifting[i] as number) > 0.5 ? 0.3 : 1) *
        (gate[i] as number);
      this.level += (target - this.level) * this.kLevel;

      let g1 = (fadeTop - fMesh) * fadeScale;
      g1 = g1 < 0 ? 0 : g1 > 1 ? 1 : g1;
      let g2 = (fadeTop - 2 * fMesh) * fadeScale;
      g2 = g2 < 0 ? 0 : g2 > 1 ? 1 : g2;
      let gf = (fadeTop - fFinal) * fadeScale;
      gf = gf < 0 ? 0 : gf > 1 ? 1 : gf;
      // Mesh fundamental and second harmonic, and the final drive, from the table.
      const x1 = this.meshPhase * SINE_STEPS;
      let k = x1 | 0;
      let fr = x1 - k;
      k &= SINE_MASK;
      const sin1 = (sine[k] as number) + fr * ((sine[k + 1] as number) - (sine[k] as number));
      const x2 = 2 * x1;
      k = x2 | 0;
      fr = x2 - k;
      k &= SINE_MASK;
      const sin2 = (sine[k] as number) + fr * ((sine[k + 1] as number) - (sine[k] as number));
      const xf = this.finalPhase * SINE_STEPS;
      k = xf | 0;
      fr = xf - k;
      k &= SINE_MASK;
      const sinF = (sine[k] as number) + fr * ((sine[k + 1] as number) - (sine[k] as number));
      const mesh = g1 > 0 ? g1 * sin1 + 0.25 * g2 * sin2 : 0;
      const fin = gf > 0 ? 0.5 * gf * sinF : 0;
      const v = (mesh + fin) * this.level * this.peak;
      out[i] = v;
      e += v * v;
    }
    meter[slot] = (meter[slot] as number) + e;
  }

  /** Current mesh frequency at engine speed `w` (rad/s), Hz. For tests. */
  meshFrequency(w: number): number {
    return (w / TWO_PI) * this.meshTeeth;
  }
}
