import { Biquad, onePoleCoefficient } from './biquad';
import { CHUNK, type CarControls } from './controls';
import { L, type LayerMeters } from './meters';
import { Noise } from './noise';
import { F } from './state';
import type { Voice } from './voice';

const TWO_PI = 2 * Math.PI;
/** Speed that maps to full road and wind level, m/s (about 324 km/h). */
const V_REF = 90;

/** Mix levels of the road layers, linear. Design values, checked by the loudness tests. */
const LEVEL = {
  roll: 0.09,
  cavity: 0.05,
  wind: 0.16,
  scrub: 0.22,
  squeal: 3.2,
  kerb: 0.22,
  kerbRattle: 0.08,
  scrape: 0.3,
  thump: 0.3,
};

/**
 * Road layer v1: what the car sounds like against the ground and the air.
 * Tyre roll noise and the tyre cavity resonance by speed, scrub and squeal from per-axle
 * slip, kerb rumble at the ridge-passing rate, wind by dynamic pressure, and a plank scrape
 * with a thump on contact. Filter coefficients follow the inputs at control rate.
 *
 * Like the engine voice, it renders in stages: one per-sample loop for envelopes, then
 * filters over whole buffers, so the hot loops never box a number.
 */
export class RoadVoice implements Voice {
  readonly bus = 'effects' as const;

  private readonly dt: number;
  private readonly roll: Biquad;
  private readonly roll2: Biquad;
  private readonly cavity: Biquad;
  private readonly wind: Biquad;
  private readonly windLow: Biquad;
  private readonly scrubFront: Biquad;
  private readonly scrubRear: Biquad;
  private readonly squealFront: Biquad;
  private readonly squealRear: Biquad;
  private readonly kerbLow: Biquad;
  private readonly kerbHigh: Biquad;
  private readonly kerbRattle: Biquad;
  private readonly scrape: Biquad;
  private readonly noiseA: Noise;
  private readonly noiseB: Noise;
  private readonly noiseC: Noise;
  private readonly noiseD: Noise;
  private readonly noiseE: Noise;

  // Per-chunk buffers: noise sources, gains, and two work buffers.
  private readonly nA = new Float64Array(CHUNK);
  private readonly nB = new Float64Array(CHUNK);
  private readonly nC = new Float64Array(CHUNK);
  private readonly nD = new Float64Array(CHUNK);
  private readonly nE = new Float64Array(CHUNK);
  private readonly gRoll = new Float64Array(CHUNK);
  private readonly gCavity = new Float64Array(CHUNK);
  private readonly gWind = new Float64Array(CHUNK);
  private readonly gScrubF = new Float64Array(CHUNK);
  private readonly gScrubR = new Float64Array(CHUNK);
  private readonly gSquealF = new Float64Array(CHUNK);
  private readonly gSquealR = new Float64Array(CHUNK);
  private readonly kerbIn = new Float64Array(CHUNK);
  private readonly rattleIn = new Float64Array(CHUNK);
  private readonly gKerb = new Float64Array(CHUNK);
  private readonly scrapeIn = new Float64Array(CHUNK);
  private readonly thump = new Float64Array(CHUNK);
  private readonly work = new Float64Array(CHUNK);
  private readonly work2 = new Float64Array(CHUNK);
  private readonly gustDraw = new Float64Array(1);

  private speed = 0;
  private scrubF = 0;
  private scrubR = 0;
  private squealF = 0;
  private squealR = 0;
  private kerb = 0;
  private kerbPhase = 0;
  private scrapeEnv = 0;
  private grit = 0;
  private gritHold = 0;
  private gritCount = 0;
  private gust = 0;
  private gustTarget = 0;
  private wobble = 0;
  private wasBottoming = false;
  private thumpPhase = 0;
  private thumpAmp = 0;
  private squealLive = false;
  private kerbLive = false;
  private scrapeLive = false;

  private readonly kSpeed: number;
  private readonly kSlip: number;
  private readonly kKerb: number;
  private readonly kScrapeOn: number;
  private readonly kScrapeOff: number;
  private readonly kGrit: number;
  private readonly kGust: number;
  private readonly thumpDecay: number;
  private readonly gritPeriod: number;

  constructor(sampleRate: number, seeds: () => number) {
    this.dt = 1 / sampleRate;
    const bq = () => new Biquad(sampleRate);
    this.roll = bq().lowpass(200, 0.7);
    this.roll2 = bq().lowpass(200, 0.7);
    this.cavity = bq().bandpass(225, 4);
    this.wind = bq().bandpass(600, 0.6);
    this.windLow = bq().lowpass(2500, 0.7);
    this.scrubFront = bq().bandpass(1500, 0.9);
    this.scrubRear = bq().bandpass(1150, 0.9);
    this.squealFront = bq().bandpass(930, 30);
    this.squealRear = bq().bandpass(780, 30);
    this.kerbLow = bq().lowpass(260, 0.8);
    this.kerbHigh = bq().highpass(30, 0.7071);
    this.kerbRattle = bq().bandpass(850, 1.5);
    this.scrape = bq().bandpass(2700, 1.4);
    this.noiseA = new Noise(seeds());
    this.noiseB = new Noise(seeds());
    this.noiseC = new Noise(seeds());
    this.noiseD = new Noise(seeds());
    this.noiseE = new Noise(seeds());
    const k = (t: number) => onePoleCoefficient(t, sampleRate);
    this.kSpeed = k(0.03);
    this.kSlip = k(0.025);
    this.kKerb = k(0.012);
    this.kScrapeOn = k(0.004);
    this.kScrapeOff = k(0.06);
    this.kGrit = k(0.002);
    this.kGust = k(0.4);
    this.thumpDecay = Math.exp(-1 / (0.045 * sampleRate));
    this.gritPeriod = Math.round(sampleRate / 300);
  }

  render(
    controls: CarControls,
    out: Float64Array,
    n: number,
    meters: LayerMeters,
    aligned: boolean,
  ): void {
    if (aligned) this.controlUpdate(controls);
    const m = meters.sumSquares;
    this.noiseA.fill(this.nA, n);
    this.noiseB.fill(this.nB, n);
    this.noiseC.fill(this.nC, n);
    if (this.squealLive) this.noiseD.fill(this.nD, n);
    this.noiseE.fill(this.nE, n);
    this.envelopes(controls, n);

    const work = this.work;
    const work2 = this.work2;
    let e = 0;

    // Rolling noise and the cavity resonance.
    this.roll.processBlock(this.nA, work, n);
    this.roll2.processBlock(work, work, n);
    this.cavity.processBlock(this.nA, work2, n);
    for (let i = 0; i < n; i++) {
      const v =
        (work[i] as number) * (this.gRoll[i] as number) +
        (work2[i] as number) * (this.gCavity[i] as number);
      out[i] = v;
      e += v * v;
    }
    m[L.roll] = (m[L.roll] as number) + e;

    // Wind.
    e = 0;
    this.wind.processBlock(this.nB, work, n);
    this.windLow.processBlock(work, work, n);
    for (let i = 0; i < n; i++) {
      const v = (work[i] as number) * (this.gWind[i] as number);
      out[i] = (out[i] as number) + v;
      e += v * v;
    }
    m[L.wind] = (m[L.wind] as number) + e;

    // Scrub: broadband, per axle.
    e = 0;
    this.scrubFront.processBlock(this.nC, work, n);
    this.scrubRear.processBlock(this.nC, work2, n);
    for (let i = 0; i < n; i++) {
      const v =
        ((work[i] as number) * (this.gScrubF[i] as number) +
          (work2[i] as number) * (this.gScrubR[i] as number)) *
        LEVEL.scrub;
      out[i] = (out[i] as number) + v;
      e += v * v;
    }
    m[L.scrub] = (m[L.scrub] as number) + e;

    // Squeal: narrow resonances, per axle.
    if (this.squealLive) {
      e = 0;
      this.squealFront.processBlock(this.nD, work, n);
      this.squealRear.processBlock(this.nD, work2, n);
      for (let i = 0; i < n; i++) {
        const v =
          ((work[i] as number) * (this.gSquealF[i] as number) +
            (work2[i] as number) * (this.gSquealR[i] as number)) *
          LEVEL.squeal;
        out[i] = (out[i] as number) + v;
        e += v * v;
      }
      m[L.squeal] = (m[L.squeal] as number) + e;
    }

    // Kerb: smooth thumps at the ridge rate, with some rattle.
    if (this.kerbLive) {
      e = 0;
      this.kerbLow.processBlock(this.kerbIn, work, n);
      this.kerbHigh.processBlock(work, work, n);
      this.kerbRattle.processBlock(this.rattleIn, work2, n);
      for (let i = 0; i < n; i++) {
        const v =
          ((work[i] as number) * LEVEL.kerb + (work2[i] as number) * LEVEL.kerbRattle) *
          (this.gKerb[i] as number);
        out[i] = (out[i] as number) + v;
        e += v * v;
      }
      m[L.kerb] = (m[L.kerb] as number) + e;
    }

    // Bottoming: a gritty scrape while in contact, a thump on first contact.
    if (this.scrapeLive) {
      e = 0;
      this.scrape.processBlock(this.scrapeIn, work, n);
      for (let i = 0; i < n; i++) {
        const v = (work[i] as number) + (this.thump[i] as number);
        out[i] = (out[i] as number) + v;
        e += v * v;
      }
      m[L.scrape] = (m[L.scrape] as number) + e;
    }
  }

  /** Per-sample envelopes and excitation signals for this chunk. */
  private envelopes(controls: CarControls, n: number): void {
    const b = controls.buffers;
    const speedBuf = b[F.speed] as Float64Array;
    const slipF = b[F.slipFront] as Float64Array;
    const slipR = b[F.slipRear] as Float64Array;
    const kerbBuf = b[F.kerb] as Float64Array;
    const kerbFreq = b[F.kerbFrequency] as Float64Array;
    const bottoming = b[F.bottoming] as Float64Array;
    const nC = this.nC;
    const nE = this.nE;
    for (let i = 0; i < n; i++) {
      this.speed += ((speedBuf[i] as number) - this.speed) * this.kSpeed;
      const v = this.speed > 0 ? this.speed : 0;
      let vRel = v / V_REF;
      vRel = vRel > 1.3 ? 1.3 : vRel;
      // 0 below 0.5 m/s, 1 above 8 m/s (smoothstep).
      let mv = (v - 0.5) / 7.5;
      mv = mv < 0 ? 0 : mv > 1 ? 1 : mv;
      const moving = mv * mv * (3 - 2 * mv);

      this.gRoll[i] = LEVEL.roll * vRel * (0.6 + 0.4 * vRel);
      this.gCavity[i] = LEVEL.cavity * vRel;
      this.gust += (this.gustTarget - this.gust) * this.kGust;
      this.gWind[i] = LEVEL.wind * vRel * vRel * (1 + this.gust);

      // Slip: scrub from 0.02 to 0.12, squeal from 0.08 to 0.2 (smoothsteps).
      const sf = Math.abs(slipF[i] as number);
      const sr = Math.abs(slipR[i] as number);
      let t = (sf - 0.02) / 0.1;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      this.scrubF += (t * t * (3 - 2 * t) * moving - this.scrubF) * this.kSlip;
      t = (sr - 0.02) / 0.1;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      this.scrubR += (t * t * (3 - 2 * t) * moving - this.scrubR) * this.kSlip;
      this.gScrubF[i] = this.scrubF;
      this.gScrubR[i] = this.scrubR;
      if (this.squealLive) {
        t = (sf - 0.08) / 0.12;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        this.squealF += (t * t * (3 - 2 * t) * moving - this.squealF) * this.kSlip;
        t = (sr - 0.08) / 0.12;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        this.squealR += (t * t * (3 - 2 * t) * moving - this.squealR) * this.kSlip;
        if (sf < 0.08 && sr < 0.08 && this.squealF + this.squealR < 1e-7) {
          this.squealF = 0;
          this.squealR = 0;
        }
        this.gSquealF[i] = this.squealF;
        this.gSquealR[i] = this.squealR;
      }

      if (this.kerbLive) {
        let target = kerbBuf[i] as number;
        target = target < 0 ? 0 : target > 1 ? 1 : target;
        this.kerb += (target - this.kerb) * this.kKerb;
        if (target === 0 && this.kerb < 1e-7) this.kerb = 0;
        const f = kerbFreq[i] as number;
        this.kerbPhase += (f > 0 ? f : 0) * this.dt;
        if (this.kerbPhase >= 1) this.kerbPhase -= 1;
        const s = Math.sin(Math.PI * this.kerbPhase);
        const pulse = s * s * s * s;
        const noise = nE[i] as number;
        this.kerbIn[i] = pulse * (0.6 + 0.4 * noise);
        this.rattleIn[i] = pulse * noise;
        this.gKerb[i] = this.kerb;
      }

      if (this.scrapeLive) {
        let bt = bottoming[i] as number;
        bt = bt < 0 ? 0 : bt > 1 ? 1 : bt;
        const contact = bt > 0.02;
        if (contact && !this.wasBottoming) {
          this.thumpPhase = 0;
          this.thumpAmp = LEVEL.thump * bt;
        }
        this.wasBottoming = contact;
        // Scrape needs the car moving: 0 below 2 m/s, full above 15 m/s.
        let sv = (v - 2) / 13;
        sv = sv < 0 ? 0 : sv > 1 ? 1 : sv;
        const target = bt * sv * sv * (3 - 2 * sv);
        this.scrapeEnv +=
          (target - this.scrapeEnv) * (target > this.scrapeEnv ? this.kScrapeOn : this.kScrapeOff);
        if (!contact && this.scrapeEnv < 1e-7) this.scrapeEnv = 0;
        if (++this.gritCount >= this.gritPeriod) {
          this.gritCount = 0;
          const r = nE[i] as number;
          this.gritHold = 0.3 + 0.7 * (r < 0 ? -r : r);
        }
        this.grit += (this.gritHold - this.grit) * this.kGrit;
        this.scrapeIn[i] = (nC[i] as number) * this.grit * this.scrapeEnv * LEVEL.scrape;
        if (this.thumpAmp > 1e-7) {
          // A decaying 65 Hz sine that starts at zero phase, so it starts without a step.
          this.thump[i] = Math.sin(TWO_PI * 65 * this.thumpPhase) * this.thumpAmp;
          this.thumpPhase += this.dt;
          this.thumpAmp *= this.thumpDecay;
        } else {
          this.thumpAmp = 0;
          this.thump[i] = 0;
        }
      }
    }
  }

  /** Control-rate work: speed-dependent filters, squeal wobble, gusts, waking layers. */
  private controlUpdate(controls: CarControls): void {
    const b = controls.buffers;
    const vn = Math.min(1.3, Math.max(0, this.speed) / V_REF);
    // Retune through fields (see Biquad): no fractional call arguments on the audio thread.
    this.roll.frequency = 90 + 520 * vn;
    this.roll.design();
    this.roll2.frequency = 90 + 520 * vn;
    this.roll2.design();
    this.wind.frequency = 280 + 1400 * vn;
    this.wind.design();
    this.wobble += (CHUNK * this.dt * TWO_PI) / 0.19;
    if (this.wobble > TWO_PI) {
      this.wobble -= TWO_PI;
      this.noiseE.draw(this.gustDraw, 1);
      this.gustTarget = 0.25 * (2 * (this.gustDraw[0] as number) - 1);
    }
    const wob = Math.sin(this.wobble) * 0.018;
    this.squealFront.frequency = 930 * (1 + wob);
    this.squealFront.design();
    this.squealRear.frequency = 780 * (1 - wob * 0.8);
    this.squealRear.design();

    // Optional layers sleep while silent; their filters restart from rest when they wake.
    const squealNow =
      this.squealF + this.squealR > 0 ||
      ((b[F.slipFront] as Float64Array)[0] as number) > 0.08 ||
      ((b[F.slipRear] as Float64Array)[0] as number) > 0.08 ||
      controls.targetOf(F.slipFront) > 0.08 ||
      controls.targetOf(F.slipRear) > 0.08;
    if (squealNow && !this.squealLive) {
      this.squealFront.reset();
      this.squealRear.reset();
    }
    this.squealLive = squealNow;
    const kerbNow =
      this.kerb > 0 ||
      ((b[F.kerb] as Float64Array)[0] as number) > 0 ||
      controls.targetOf(F.kerb) > 0;
    if (kerbNow && !this.kerbLive) {
      this.kerbLow.reset();
      this.kerbHigh.reset();
      this.kerbRattle.reset();
    }
    this.kerbLive = kerbNow;
    const scrapeNow =
      this.scrapeEnv > 0 ||
      this.thumpAmp > 0 ||
      ((b[F.bottoming] as Float64Array)[0] as number) > 0 ||
      controls.targetOf(F.bottoming) > 0;
    if (scrapeNow && !this.scrapeLive) this.scrape.reset();
    this.scrapeLive = scrapeNow;
  }
}
