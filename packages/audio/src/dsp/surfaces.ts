import { Biquad, onePoleCoefficient } from './biquad';
import { CHUNK } from './controls';
import { Noise } from './noise';

/** Mix levels, linear. Design values, checked by the loudness and layer tests. */
const LEVEL = {
  grassRumble: 0.55,
  grassSwish: 0.16,
  gravelRoar: 0.35,
  gravelGrain: 0.5,
  gravelCrunch: 0.3,
};

/**
 * The ground off the racing surface: grass and gravel, each by the share of contact points on
 * it, and by speed. (Asphalt is the road voice's rolling noise; kerbs are their own layer.)
 *
 * - **Grass:** a soft low rumble (noise below 140 Hz) with a broad swish around 1.1 kHz, both
 *   modulated by slow random bumpiness (a value redrawn at about 12 Hz and smoothed), rising
 *   with speed to the power 0.8.
 * - **Gravel:** a low roar (below 180 Hz) plus grains: random impulses whose rate rises with
 *   speed (300 + 60 × v per second, so about 3300 per second at 180 km/h), each of random
 *   strength, through a 3.2 kHz resonance (stones on the floor and tub) and a 700 Hz one
 *   (the crunch of the bed). Grains come from a seeded noise source, so renders repeat.
 *
 * Design values. Asphalt's share is what remains, and the road voice scales its rolling noise
 * by it.
 */
export class SurfaceLayers {
  private readonly dt: number;
  private readonly grassLow: Biquad;
  private readonly grassSwish: Biquad;
  private readonly gravelLow: Biquad;
  private readonly gravelHigh: Biquad;
  private readonly gravelMid: Biquad;
  private readonly noiseA: Noise;
  private readonly noiseB: Noise;
  private readonly nA = new Float64Array(CHUNK);
  private readonly nB = new Float64Array(CHUNK);
  private readonly gGrass = new Float64Array(CHUNK);
  private readonly gGravel = new Float64Array(CHUNK);
  private readonly grains = new Float64Array(CHUNK);
  private readonly work = new Float64Array(CHUNK);
  private readonly work2 = new Float64Array(CHUNK);
  private readonly bumpDraw = new Float64Array(1);
  private grass = 0;
  private gravel = 0;
  private bump = 0;
  private bumpTarget = 0;
  private bumpCount = 0;
  private readonly bumpPeriod: number;
  private readonly kShare: number;
  private readonly kBump: number;
  /** Whether either layer is sounding (or about to): they sleep while silent. */
  live = false;

  constructor(sampleRate: number, seeds: () => number) {
    this.dt = 1 / sampleRate;
    const bq = () => new Biquad(sampleRate);
    this.grassLow = bq().lowpass(140, 0.7);
    this.grassSwish = bq().bandpass(1100, 0.6);
    this.gravelLow = bq().lowpass(180, 0.7);
    this.gravelHigh = bq().bandpass(3200, 1.5);
    this.gravelMid = bq().bandpass(700, 1);
    this.noiseA = new Noise(seeds());
    this.noiseB = new Noise(seeds());
    this.bumpPeriod = Math.round(sampleRate / 12);
    this.kShare = onePoleCoefficient(0.04, sampleRate);
    this.kBump = onePoleCoefficient(0.03, sampleRate);
  }

  /** Control rate: wake when either share is, or is heading, above zero. */
  wake(grassNow: boolean, gravelNow: boolean): void {
    const now = this.grass + this.gravel > 0 || grassNow || gravelNow;
    if (now && !this.live) {
      this.grassLow.reset();
      this.grassSwish.reset();
      this.gravelLow.reset();
      this.gravelHigh.reset();
      this.gravelMid.reset();
    }
    this.live = now;
  }

  /**
   * Add `n` samples of both layers into `out`. `speedRel` is speed over the reference speed
   * (smoothed, per sample) and `moving` the 0–1 gate that silences the car at rest. Adds each
   * layer's energy to `meter[grassSlot]` and `meter[gravelSlot]`.
   */
  renderAdd(
    grassIn: Float64Array,
    gravelIn: Float64Array,
    speed: Float64Array,
    speedRel: Float64Array,
    moving: Float64Array,
    out: Float64Array,
    n: number,
    meter: Float64Array,
    grassSlot: number,
    gravelSlot: number,
  ): void {
    if (!this.live) return;
    this.noiseA.fill(this.nA, n);
    this.noiseB.fill(this.nB, n);
    const nA = this.nA;
    const nB = this.nB;
    const dt = this.dt;
    for (let i = 0; i < n; i++) {
      let g = grassIn[i] as number;
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      let r = gravelIn[i] as number;
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      this.grass += (g - this.grass) * this.kShare;
      this.gravel += (r - this.gravel) * this.kShare;
      if (g === 0 && this.grass < 1e-7) this.grass = 0;
      if (r === 0 && this.gravel < 1e-7) this.gravel = 0;
      if (++this.bumpCount >= this.bumpPeriod) {
        this.bumpCount = 0;
        this.noiseB.draw(this.bumpDraw, 1);
        this.bumpTarget = this.bumpDraw[0] as number;
      }
      this.bump += (this.bumpTarget - this.bump) * this.kBump;
      const vr = speedRel[i] as number;
      const mv = moving[i] as number;
      this.gGrass[i] = this.grass * Math.pow(vr, 0.8) * mv * (0.6 + 0.8 * this.bump);
      this.gGravel[i] = this.gravel * vr * mv;
      // Grains: uniform draw from noise B against the rate for this sample.
      const v = speed[i] as number;
      const p = (300 + 60 * (v > 0 ? v : 0)) * dt;
      const u = 0.5 * ((nB[i] as number) + 1);
      this.grains[i] = this.gravel > 0 && u < p ? (nA[i] as number) : 0;
    }

    const work = this.work;
    const work2 = this.work2;
    let e = 0;
    this.grassLow.processBlock(nA, work, n);
    this.grassSwish.processBlock(nA, work2, n);
    for (let i = 0; i < n; i++) {
      const v =
        ((work[i] as number) * LEVEL.grassRumble + (work2[i] as number) * LEVEL.grassSwish) *
        (this.gGrass[i] as number);
      out[i] = (out[i] as number) + v;
      e += v * v;
    }
    meter[grassSlot] = (meter[grassSlot] as number) + e;

    e = 0;
    this.gravelLow.processBlock(nA, work, n);
    this.gravelHigh.processBlock(this.grains, work2, n);
    for (let i = 0; i < n; i++) {
      const v =
        ((work[i] as number) * LEVEL.gravelRoar + (work2[i] as number) * LEVEL.gravelGrain) *
        (this.gGravel[i] as number);
      out[i] = (out[i] as number) + v;
      e += v * v;
    }
    this.gravelMid.processBlock(this.grains, work2, n);
    for (let i = 0; i < n; i++) {
      const v = (work2[i] as number) * LEVEL.gravelCrunch * (this.gGravel[i] as number);
      out[i] = (out[i] as number) + v;
      e += v * v;
    }
    meter[gravelSlot] = (meter[gravelSlot] as number) + e;
  }
}
