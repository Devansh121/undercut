import { Biquad, onePoleCoefficient } from './biquad';
import { Burst } from './burst';
import { CHUNK, type CarControls } from './controls';
import { ImpactVoice } from './impact';
import { L, type LayerMeters } from './meters';
import { Noise } from './noise';
import { F, SLIP_LIMIT } from './state';
import { SurfaceLayers } from './surfaces';
import { G, type ViewMix } from './view';
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
  lockup: 2.4,
  wheelspin: 0.32,
  kerb: 0.22,
  kerbRattle: 0.08,
  scrape: 0.3,
  thump: 0.3,
  /** DRS flap actuator, thousandths (see `Burst.trigger`). */
  drsMilli: 160,
};

/**
 * Tyre slip, in multiples of the force peak (`SLIP_LIMIT`): where each voice starts and is
 * full. Below the peak the tyre scrubs; past it, it slides and squeals. Locking and spinning
 * have their own voices, keyed on the signed slip ratio.
 */
export const SLIP_VOICES = {
  /** Scrub rises as ((σ − onset) / (1 − onset))^1.5 from `onset` to the peak, then holds. */
  scrubOnset: 0.3,
  /** Slide (squeal and judder) from the peak to `slideFull` × the peak (smoothstep). */
  slideFull: 2,
  /** Lock-up howl as the slip ratio goes from −`lockStart` to −`lockFull` (smoothstep). */
  lockStart: 0.15,
  lockFull: 0.5,
  /** Wheelspin rasp as the slip ratio goes from `spinStart` to `spinFull` (smoothstep). */
  spinStart: 0.15,
  spinFull: 0.65,
  /** Lock-up howl pitch, Hz (front; the rear is 12 % lower). */
  lockupFrequency: 1350,
  /** Wheelspin rasp band, Hz, and its tread-chatter rate, Hz. */
  wheelspinFrequency: 560,
  chatterRate: 31,
  /** Stick-slip judder rate while sliding, Hz (rises 9 Hz towards full slide). */
  judderRate: 17,
} as const;

/** DRS: wind level and band centre with the flap fully open, relative to closed. */
export const DRS_WIND = { level: 0.7, frequency: 1.25 } as const;

/**
 * Road voice: what the car sounds like against the ground and the air.
 *
 * Tyre rolling noise and the cavity resonance on asphalt; grass and gravel (`SurfaceLayers`);
 * per-axle scrub building below the grip limit, a sliding squeal with stick-slip judder past
 * it, a lock-up howl and a wheelspin rasp from the signed slip ratio; kerb rumble at the
 * ridge-passing rate; wind by dynamic pressure, changed by the DRS flap with a clunk when it
 * moves; plank scrape with a thump on contact; impacts (`ImpactVoice`). Filter coefficients
 * follow the inputs at control rate.
 *
 * Like the engine voice it renders in stages: one per-sample loop for envelopes, then
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
  private readonly lockupLow: Biquad;
  private readonly lockupHigh: Biquad;
  private readonly spinLow: Biquad;
  private readonly spinHigh: Biquad;
  private readonly kerbLow: Biquad;
  private readonly kerbHigh: Biquad;
  private readonly kerbRattle: Biquad;
  private readonly scrape: Biquad;
  private readonly noiseA: Noise;
  private readonly noiseB: Noise;
  private readonly noiseC: Noise;
  private readonly noiseD: Noise;
  private readonly noiseE: Noise;
  private readonly noiseF: Noise;
  private readonly surfaces: SurfaceLayers;
  /** Impacts, from the barrier and car contact telemetry. */
  readonly impacts: ImpactVoice;
  private readonly flap: Burst;

  // Per-chunk buffers: noise sources, gains, and work buffers.
  private readonly nA = new Float64Array(CHUNK);
  private readonly nB = new Float64Array(CHUNK);
  private readonly nC = new Float64Array(CHUNK);
  private readonly nD = new Float64Array(CHUNK);
  private readonly nE = new Float64Array(CHUNK);
  private readonly nF = new Float64Array(CHUNK);
  private readonly gRoll = new Float64Array(CHUNK);
  private readonly gCavity = new Float64Array(CHUNK);
  private readonly gWind = new Float64Array(CHUNK);
  private readonly gScrubF = new Float64Array(CHUNK);
  private readonly gScrubR = new Float64Array(CHUNK);
  private readonly gSquealF = new Float64Array(CHUNK);
  private readonly gSquealR = new Float64Array(CHUNK);
  private readonly gLock = new Float64Array(CHUNK);
  private readonly gSpin = new Float64Array(CHUNK);
  private readonly speedRel = new Float64Array(CHUNK);
  private readonly movingBuf = new Float64Array(CHUNK);
  private readonly kerbIn = new Float64Array(CHUNK);
  private readonly rattleIn = new Float64Array(CHUNK);
  private readonly gKerb = new Float64Array(CHUNK);
  private readonly scrapeIn = new Float64Array(CHUNK);
  private readonly thump = new Float64Array(CHUNK);
  private readonly road = new Float64Array(CHUNK);
  private readonly windOut = new Float64Array(CHUNK);
  private readonly work = new Float64Array(CHUNK);
  private readonly work2 = new Float64Array(CHUNK);
  private readonly gustDraw = new Float64Array(1);

  private speed = 0;
  private scrubF = 0;
  private scrubR = 0;
  private squealF = 0;
  private squealR = 0;
  private lock = 0;
  private spin = 0;
  private judderPhase = 0;
  private chatterPhase = 0;
  private drs = 0;
  private drsOpen = false;
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
  private slipToneLive = false;
  private kerbLive = false;
  private scrapeLive = false;
  /** Sample in the chunk of the event being handled (a field: see `flapMoved`). */
  private evIndex = 0;

  private readonly kSpeed: number;
  private readonly kSlip: number;
  private readonly kKerb: number;
  private readonly kDrs: number;
  private readonly kScrapeOn: number;
  private readonly kScrapeOff: number;
  private readonly kGrit: number;
  private readonly kGust: number;
  private readonly thumpDecay: number;
  private readonly gritPeriod: number;
  private readonly flapLength: number;
  private readonly flapRing: number;

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
    this.lockupLow = bq().bandpass(SLIP_VOICES.lockupFrequency, 45);
    this.lockupHigh = bq().bandpass(2 * SLIP_VOICES.lockupFrequency, 45);
    this.spinLow = bq().bandpass(SLIP_VOICES.wheelspinFrequency, 3);
    this.spinHigh = bq().bandpass(2200, 1.2);
    this.kerbLow = bq().lowpass(260, 0.8);
    this.kerbHigh = bq().highpass(30, 0.7071);
    this.kerbRattle = bq().bandpass(850, 1.5);
    this.scrape = bq().bandpass(2700, 1.4);
    this.noiseA = new Noise(seeds());
    this.noiseB = new Noise(seeds());
    this.noiseC = new Noise(seeds());
    this.noiseD = new Noise(seeds());
    this.noiseE = new Noise(seeds());
    this.noiseF = new Noise(seeds());
    this.surfaces = new SurfaceLayers(sampleRate, seeds);
    this.impacts = new ImpactVoice(sampleRate, seeds());
    this.flap = new Burst(sampleRate);
    const k = (t: number) => onePoleCoefficient(t, sampleRate);
    this.kSpeed = k(0.03);
    this.kSlip = k(0.025);
    this.kKerb = k(0.012);
    this.kDrs = k(0.06);
    this.kScrapeOn = k(0.004);
    this.kScrapeOff = k(0.06);
    this.kGrit = k(0.002);
    this.kGust = k(0.4);
    this.thumpDecay = Math.exp(-1 / (0.045 * sampleRate));
    this.gritPeriod = Math.round(sampleRate / 300);
    this.flapLength = Math.round(sampleRate * 0.004);
    this.flapRing = Math.round(sampleRate * 0.03);
  }

  render(
    controls: CarControls,
    out: Float64Array,
    n: number,
    meters: LayerMeters,
    aligned: boolean,
    view: ViewMix,
  ): void {
    if (aligned) this.controlUpdate(controls);
    const b = controls.buffers;
    const m = meters.sumSquares;
    this.noiseA.fill(this.nA, n);
    this.noiseB.fill(this.nB, n);
    this.noiseC.fill(this.nC, n);
    if (this.squealLive) this.noiseD.fill(this.nD, n);
    this.noiseE.fill(this.nE, n);
    if (this.slipToneLive) this.noiseF.fill(this.nF, n);
    this.envelopes(controls, n);

    const road = this.road;
    const work = this.work;
    const work2 = this.work2;
    let e = 0;

    // Rolling noise and the cavity resonance (asphalt's share is in the gains).
    this.roll.processBlock(this.nA, work, n);
    this.roll2.processBlock(work, work, n);
    this.cavity.processBlock(this.nA, work2, n);
    for (let i = 0; i < n; i++) {
      const v =
        (work[i] as number) * (this.gRoll[i] as number) +
        (work2[i] as number) * (this.gCavity[i] as number);
      road[i] = v;
      e += v * v;
    }
    m[L.roll] = (m[L.roll] as number) + e;

    // Grass and gravel.
    this.surfaces.renderAdd(
      b[F.grass] as Float64Array,
      b[F.gravel] as Float64Array,
      b[F.speed] as Float64Array,
      this.speedRel,
      this.movingBuf,
      road,
      n,
      m,
      L.grass,
      L.gravel,
    );

    // Scrub: broadband, per axle; judders while the tyre slides.
    e = 0;
    this.scrubFront.processBlock(this.nC, work, n);
    this.scrubRear.processBlock(this.nC, work2, n);
    for (let i = 0; i < n; i++) {
      const v =
        ((work[i] as number) * (this.gScrubF[i] as number) +
          (work2[i] as number) * (this.gScrubR[i] as number)) *
        LEVEL.scrub;
      road[i] = (road[i] as number) + v;
      e += v * v;
    }
    m[L.scrub] = (m[L.scrub] as number) + e;

    // Slide: narrow squeal resonances, per axle.
    if (this.squealLive) {
      e = 0;
      this.squealFront.processBlock(this.nD, work, n);
      this.squealRear.processBlock(this.nD, work2, n);
      for (let i = 0; i < n; i++) {
        const v =
          ((work[i] as number) * (this.gSquealF[i] as number) +
            (work2[i] as number) * (this.gSquealR[i] as number)) *
          LEVEL.squeal;
        road[i] = (road[i] as number) + v;
        e += v * v;
      }
      m[L.squeal] = (m[L.squeal] as number) + e;
    }

    // Lock-up howl and wheelspin rasp.
    if (this.slipToneLive) {
      e = 0;
      this.lockupLow.processBlock(this.nF, work, n);
      this.lockupHigh.processBlock(this.nF, work2, n);
      for (let i = 0; i < n; i++) {
        const v =
          ((work[i] as number) + 0.45 * (work2[i] as number)) *
          (this.gLock[i] as number) *
          LEVEL.lockup;
        road[i] = (road[i] as number) + v;
        e += v * v;
      }
      m[L.lockup] = (m[L.lockup] as number) + e;
      e = 0;
      this.spinLow.processBlock(this.nF, work, n);
      this.spinHigh.processBlock(this.nF, work2, n);
      for (let i = 0; i < n; i++) {
        const v =
          ((work[i] as number) + 0.35 * (work2[i] as number)) *
          (this.gSpin[i] as number) *
          LEVEL.wheelspin;
        road[i] = (road[i] as number) + v;
        e += v * v;
      }
      m[L.wheelspin] = (m[L.wheelspin] as number) + e;
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
        road[i] = (road[i] as number) + v;
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
        road[i] = (road[i] as number) + v;
        e += v * v;
      }
      m[L.scrape] = (m[L.scrape] as number) + e;
    }

    // Impacts.
    this.impacts.render(
      b[F.impactSpeed] as Float64Array,
      b[F.impactSerial] as Float64Array,
      work,
      n,
      m,
      L.impact,
    );
    for (let i = 0; i < n; i++) road[i] = (road[i] as number) + (work[i] as number);

    // Wind, and the DRS flap's actuator.
    const wind = this.windOut;
    e = 0;
    this.wind.processBlock(this.nB, wind, n);
    this.windLow.processBlock(wind, wind, n);
    for (let i = 0; i < n; i++) {
      const v = (wind[i] as number) * (this.gWind[i] as number);
      wind[i] = v;
      e += v * v;
    }
    m[L.wind] = (m[L.wind] as number) + e;
    this.flap.renderAdd(this.nE, wind, n, m, L.drs);

    const vg = view.start;
    const off = view.offset;
    const vs = view.step;
    const r0 = vg[G.road] as number;
    const rs = vs[G.road] as number;
    const w0 = vg[G.wind] as number;
    const ws = vs[G.wind] as number;
    for (let i = 0; i < n; i++)
      out[i] =
        (road[i] as number) * (r0 + rs * (off + i)) + (wind[i] as number) * (w0 + ws * (off + i));
  }

  /** Per-sample envelopes and excitation signals for this chunk. */
  private envelopes(controls: CarControls, n: number): void {
    const b = controls.buffers;
    const speedBuf = b[F.speed] as Float64Array;
    const slipF = b[F.slipFront] as Float64Array;
    const slipR = b[F.slipRear] as Float64Array;
    const ratioF = b[F.slipRatioFront] as Float64Array;
    const ratioR = b[F.slipRatioRear] as Float64Array;
    const grassBuf = b[F.grass] as Float64Array;
    const gravelBuf = b[F.gravel] as Float64Array;
    const drsBuf = b[F.drs] as Float64Array;
    const kerbBuf = b[F.kerb] as Float64Array;
    const kerbFreq = b[F.kerbFrequency] as Float64Array;
    const bottoming = b[F.bottoming] as Float64Array;
    const nC = this.nC;
    const nE = this.nE;
    const invLimit = 1 / SLIP_LIMIT;
    const onset = SLIP_VOICES.scrubOnset;
    const invOnsetSpan = 1 / (1 - onset);
    const invSlide = 1 / (SLIP_VOICES.slideFull - 1);
    const lockStart = SLIP_VOICES.lockStart;
    const invLock = 1 / (SLIP_VOICES.lockFull - lockStart);
    const spinStart = SLIP_VOICES.spinStart;
    const invSpin = 1 / (SLIP_VOICES.spinFull - spinStart);
    const dt = this.dt;
    for (let i = 0; i < n; i++) {
      this.speed += ((speedBuf[i] as number) - this.speed) * this.kSpeed;
      const v = this.speed > 0 ? this.speed : 0;
      let vRel = v / V_REF;
      vRel = vRel > 1.3 ? 1.3 : vRel;
      // 0 below 0.5 m/s, 1 above 8 m/s (smoothstep).
      let mv = (v - 0.5) / 7.5;
      mv = mv < 0 ? 0 : mv > 1 ? 1 : mv;
      const moving = mv * mv * (3 - 2 * mv);
      this.speedRel[i] = vRel;
      this.movingBuf[i] = moving;

      let asphalt = 1 - (grassBuf[i] as number) - (gravelBuf[i] as number);
      asphalt = asphalt < 0 ? 0 : asphalt > 1 ? 1 : asphalt;
      this.gRoll[i] = LEVEL.roll * vRel * (0.6 + 0.4 * vRel) * asphalt;
      this.gCavity[i] = LEVEL.cavity * vRel * (0.5 + 0.5 * asphalt);

      // DRS: the open flap sheds less turbulence; the band moves up.
      let d = drsBuf[i] as number;
      d = d < 0 ? 0 : d > 1 ? 1 : d;
      this.drs += (d - this.drs) * this.kDrs;
      const open = d > 0.5;
      if (open !== this.drsOpen) {
        this.drsOpen = open;
        this.evIndex = i;
        this.flapMoved();
      }
      this.gust += (this.gustTarget - this.gust) * this.kGust;
      this.gWind[i] =
        LEVEL.wind * vRel * vRel * (1 + this.gust) * (1 - (1 - DRS_WIND.level) * this.drs);

      // Slip in multiples of the force peak.
      const sf = (slipF[i] as number) * invLimit;
      const sr = (slipR[i] as number) * invLimit;
      const kf = ratioF[i] as number;
      const kr = ratioR[i] as number;
      // Lock-up and wheelspin, from the signed slip ratio of either axle.
      let x = (-kf - lockStart) * invLock;
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      const lockF = x * x * (3 - 2 * x);
      x = (-kr - lockStart) * invLock;
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      const lockR = x * x * (3 - 2 * x);
      const lockT = (lockF > lockR ? lockF : lockR) * moving;
      x = (kf - spinStart) * invSpin;
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      const spinF = x * x * (3 - 2 * x);
      x = (kr - spinStart) * invSpin;
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      const spinR = x * x * (3 - 2 * x);
      const spinT = (spinF > spinR ? spinF : spinR) * mv;
      this.lock += (lockT - this.lock) * this.kSlip;
      this.spin += (spinT - this.spin) * this.kSlip;
      if (lockT === 0 && this.lock < 1e-7) this.lock = 0;
      if (spinT === 0 && this.spin < 1e-7) this.spin = 0;

      // Scrub: from the onset to the peak, then held.
      let t = (sf - onset) * invOnsetSpan;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      this.scrubF += (t * Math.sqrt(t) * moving - this.scrubF) * this.kSlip;
      t = (sr - onset) * invOnsetSpan;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      this.scrubR += (t * Math.sqrt(t) * moving - this.scrubR) * this.kSlip;
      // Past the peak the scrub judders (stick-slip) as the slide builds.
      x = (sf - 1) * invSlide;
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      const slideF = x * x * (3 - 2 * x);
      x = (sr - 1) * invSlide;
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      const slideR = x * x * (3 - 2 * x);
      const slide = slideF > slideR ? slideF : slideR;
      this.judderPhase += (SLIP_VOICES.judderRate + 9 * slide) * dt;
      if (this.judderPhase >= 1) this.judderPhase -= 1;
      const judder = 1 - 0.6 * slide * (0.5 + 0.5 * Math.sin(TWO_PI * this.judderPhase));
      this.gScrubF[i] = this.scrubF * judder;
      this.gScrubR[i] = this.scrubR * judder;
      if (this.squealLive) {
        // A locked or spinning tyre howls or rasps instead of squealing.
        const keepF = (1 - 0.85 * lockF) * (1 - 0.85 * spinF);
        const keepR = (1 - 0.85 * lockR) * (1 - 0.85 * spinR);
        this.squealF += (slideF * keepF * moving - this.squealF) * this.kSlip;
        this.squealR += (slideR * keepR * moving - this.squealR) * this.kSlip;
        if (sf < 1 && sr < 1 && this.squealF + this.squealR < 1e-7) {
          this.squealF = 0;
          this.squealR = 0;
        }
        this.gSquealF[i] = this.squealF;
        this.gSquealR[i] = this.squealR;
      }
      if (this.slipToneLive) {
        this.chatterPhase += (SLIP_VOICES.chatterRate + 0.15 * v) * dt;
        if (this.chatterPhase >= 1) this.chatterPhase -= 1;
        this.gLock[i] = this.lock;
        this.gSpin[i] = this.spin * (0.55 + 0.45 * Math.sin(TWO_PI * this.chatterPhase));
      }

      if (this.kerbLive) {
        let target = kerbBuf[i] as number;
        target = target < 0 ? 0 : target > 1 ? 1 : target;
        this.kerb += (target - this.kerb) * this.kKerb;
        if (target === 0 && this.kerb < 1e-7) this.kerb = 0;
        const f = kerbFreq[i] as number;
        this.kerbPhase += (f > 0 ? f : 0) * dt;
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
          this.thumpPhase += dt;
          this.thumpAmp *= this.thumpDecay;
        } else {
          this.thumpAmp = 0;
          this.thump[i] = 0;
        }
      }
    }
  }

  /** The DRS flap opened or closed at sample `evIndex`: the actuator's knock, louder opening. */
  private flapMoved(): void {
    const v = this.speed > 0 ? this.speed : 0;
    const level = v > 20 ? 1 : v / 20;
    this.flap.trigger(
      this.evIndex,
      this.flapLength,
      this.flapRing,
      Math.round(LEVEL.drsMilli * level * (this.drsOpen ? 1 : 0.7)),
      this.drsOpen ? 330 : 280,
      20,
    );
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
    this.wind.frequency = (280 + 1400 * vn) * (1 + (DRS_WIND.frequency - 1) * this.drs);
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
    const limit = SLIP_LIMIT;
    const squealNow =
      this.squealF + this.squealR > 0 ||
      ((b[F.slipFront] as Float64Array)[0] as number) > limit ||
      ((b[F.slipRear] as Float64Array)[0] as number) > limit ||
      controls.targetOf(F.slipFront) > limit ||
      controls.targetOf(F.slipRear) > limit;
    if (squealNow && !this.squealLive) {
      this.squealFront.reset();
      this.squealRear.reset();
    }
    this.squealLive = squealNow;
    const rf = (b[F.slipRatioFront] as Float64Array)[0] as number;
    const rr = (b[F.slipRatioRear] as Float64Array)[0] as number;
    const tf = controls.targetOf(F.slipRatioFront);
    const tr = controls.targetOf(F.slipRatioRear);
    const lo = -SLIP_VOICES.lockStart;
    const hi = SLIP_VOICES.spinStart;
    const toneNow =
      this.lock + this.spin > 0 ||
      rf < lo ||
      rr < lo ||
      tf < lo ||
      tr < lo ||
      rf > hi ||
      rr > hi ||
      tf > hi ||
      tr > hi;
    if (toneNow && !this.slipToneLive) {
      this.lockupLow.reset();
      this.lockupHigh.reset();
      this.spinLow.reset();
      this.spinHigh.reset();
    }
    this.slipToneLive = toneNow;
    this.surfaces.wake(
      ((b[F.grass] as Float64Array)[0] as number) > 0 || controls.targetOf(F.grass) > 0,
      ((b[F.gravel] as Float64Array)[0] as number) > 0 || controls.targetOf(F.gravel) > 0,
    );
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
