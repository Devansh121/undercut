import { Biquad } from './biquad';
import { CHUNK } from './controls';
import { Noise } from './noise';
import { SINE_MASK, SINE_STEPS, SINE_TABLE } from './sine';

/**
 * Circuit ambience on the ambience bus: a crowd bed whose level and side come from the
 * grandstands around the listener, and a location bed per circuit. Everything is synthesised
 * from seeded noise and sines; nothing is a loop, so nothing repeats audibly.
 *
 * - Crowd: two decorrelated noise streams band-passed at 700 Hz (Q 0.5, the speech band of a
 *   murmur) and low-passed at 2.2 kHz (one pole: distance), with two slow swells (0.13 and 0.31 Hz). Lights out raises it by up to +8 dB with
 *   a 0.8 s rise and a 6 s fall (a cheer).
 * - Trees: decorrelated noise band-passed at 550 Hz (Q 0.8) under a gust envelope from two
 *   slow sines (0.07 and 0.19 Hz). Forest full, parkland about half.
 * - Birds: calls of 3 to 6 falling notes (2.6 to 4.4 kHz, 70 ms each with 45 ms gaps) every
 *   1.5 to 6 s at a random side. Daytime circuits only.
 * - City at night: traffic rumble (noise low-passed at 140 Hz), floodlight transformer hum at
 *   twice the 50 Hz mains (100, 200, 300 Hz) and insects (noise band-passed at 5.2 kHz, Q 3,
 *   pulsed at 38 Hz in slow waves).
 * - City by day: the same rumble, no floodlights or insects, a few birds.
 */

export type AmbienceKind = 'none' | 'park' | 'forest' | 'city-night' | 'city-day';
/** In this order on the wire (the scene sends the index): new kinds go at the end. */
export const AMBIENCE_KINDS: readonly AmbienceKind[] = [
  'none',
  'park',
  'forest',
  'city-night',
  'city-day',
];

/**
 * Level of each location layer per circuit kind, 0–1; `night` is the share of the city layer's
 * floodlight hum and insects (the traffic rumble is the city's day and night).
 */
export const AMBIENCE_PROFILES: Readonly<
  Record<AmbienceKind, { trees: number; birds: number; city: number; night: number }>
> = {
  none: { trees: 0, birds: 0, city: 0, night: 0 },
  park: { trees: 0.45, birds: 0.6, city: 0, night: 0 },
  forest: { trees: 1, birds: 1, city: 0, night: 0 },
  'city-night': { trees: 0, birds: 0, city: 1, night: 1 },
  'city-day': { trees: 0, birds: 0.2, city: 1, night: 0 },
};

/** −10 dB from the first cut, which put a full stand level with the field (PR 51 review). */
const CROWD_GAIN = 0.079;
/** Insect pulse rate, Hz. */
const INSECT_HZ = 38;
const TREES_GAIN = 0.08;
const BIRD_GAIN = 0.02;
const RUMBLE_GAIN = 0.25;
const INSECT_GAIN = 0.12;
/** Floodlight hum partials at 100, 200 and 300 Hz. */
const HUM_1 = 0.008;
const HUM_2 = 0.004;
const HUM_3 = 0.002;
/** A crowd 20 m and more away loses its top: one-pole low-pass at 2.2 kHz after the band-pass. */
const CROWD_TOP = 2200;
/** Level changes follow the listener over half a second. */
const LEVEL_TIME = 0.5;

const TWO_PI = 2 * Math.PI;

export class Ambience {
  private readonly sampleRate: number = 48_000;
  private readonly noiseL: Noise;
  private readonly noiseR: Noise;
  private readonly events: Noise;
  private readonly a = new Float64Array(CHUNK);
  private readonly b = new Float64Array(CHUNK);
  private readonly c = new Float64Array(CHUNK);
  private readonly d = new Float64Array(CHUNK);
  private readonly crowdL: Biquad;
  private readonly crowdR: Biquad;
  private readonly treesL: Biquad;
  private readonly treesR: Biquad;
  private readonly rumbleL: Biquad;
  private readonly rumbleR: Biquad;
  private readonly insects: Biquad;
  /** Level smoothing over one chunk, and the cheer's rise and fall per chunk. */
  private readonly kChunk: number;
  private readonly kCheerRise: number;
  private readonly cheerFall: number;
  // Targets and smoothed levels.
  crowdTargetL = 0;
  crowdTargetR = 0;
  treesTarget = 0;
  birdsTarget = 0;
  cityTarget = 0;
  /** Share of the city layer's hum and insects (`AMBIENCE_PROFILES` night). */
  private night = 0;
  crowdLevelL = 0;
  crowdLevelR = 0;
  treesLevel = 0;
  birdsLevel = 0;
  cityLevel = 0;
  private readonly crowdTop: number;
  private crowdLowL = 0;
  private crowdLowR = 0;
  private crowdFromL = 0;
  private crowdFromR = 0;
  private treesFrom = 0;
  private cityFrom = 0;
  private crowdLift = 0;
  private gust = 0;
  private insectWave = 0;
  private birdsAwake = false;
  private cheer = 0;
  private cheerTarget = 0;
  private clock = 0;
  // Birds.
  private birdWait = 0;
  private birdNotes = 0;
  private birdAge = 0;
  private birdHz = 3000;
  private birdPan = 0.5;
  private birdPhase = 0;
  // Hum.
  private humPhase = 0;
  private insectPhase = 0;
  private crowdAwake = false;
  private treesAwake = false;
  private cityAwake = false;

  constructor(sampleRate: number, seed: number) {
    this.sampleRate = sampleRate;
    this.noiseL = new Noise(seed ^ 0x51ed27);
    this.noiseR = new Noise(seed ^ 0x2b1a9e);
    this.events = new Noise(seed ^ 0x7f4a7c);
    this.crowdL = new Biquad(sampleRate).bandpass(700, 0.5);
    this.crowdR = new Biquad(sampleRate).bandpass(700, 0.5);
    this.treesL = new Biquad(sampleRate).bandpass(550, 0.8);
    this.treesR = new Biquad(sampleRate).bandpass(550, 0.8);
    this.rumbleL = new Biquad(sampleRate).lowpass(140, 0.7);
    this.rumbleR = new Biquad(sampleRate).lowpass(140, 0.7);
    this.insects = new Biquad(sampleRate).bandpass(Math.min(5200, 0.4 * sampleRate), 3);
    this.crowdTop = 1 - Math.exp((-2 * Math.PI * CROWD_TOP) / sampleRate);
    this.kChunk = 1 - Math.exp(-CHUNK / (LEVEL_TIME * sampleRate));
    this.kCheerRise = 1 - Math.exp(-CHUNK / (0.8 * sampleRate));
    this.cheerFall = Math.exp(-CHUNK / (6 * sampleRate));
    this.birdWait = Math.round(sampleRate * (1 + 2 * this.events.unit()));
  }

  /** The circuit's bed, and the crowd level at each ear from `crowd[at]` and `crowd[at + 1]`. */
  set(kind: AmbienceKind, crowd: Float64Array, at: number): void {
    const p = AMBIENCE_PROFILES[kind] ?? AMBIENCE_PROFILES.none;
    this.treesTarget = p.trees;
    this.birdsTarget = p.birds;
    this.cityTarget = p.city;
    this.night = p.night;
    this.crowdTargetL = crowd[at] as number;
    this.crowdTargetR = crowd[at + 1] as number;
  }

  /** Lights out: the stands cheer. */
  cheerNow(): void {
    this.cheerTarget = 1;
  }

  /**
   * Add `n` samples. Every slow quantity (levels, swells, gusts, waking and sleeping) moves on
   * the core's 32-frame chunk grid of this object's own sample clock, and samples inside a chunk
   * ramp linearly, so the output does not depend on how the host splits its blocks.
   */
  render(left: Float64Array, right: Float64Array, n: number): void {
    const offset = this.clock % CHUNK;
    if (offset === 0) this.advanceChunk();
    const a = this.a;
    const b = this.b;
    const c = this.c;
    const d = this.d;
    this.noiseL.fill(a, n);
    this.noiseR.fill(b, n);

    if (this.crowdAwake) {
      this.crowdL.processBlock(a, c, n);
      this.crowdR.processBlock(b, d, n);
      const lift = this.crowdLift;
      const g0L = this.crowdFromL;
      const g0R = this.crowdFromR;
      const stepL = (this.crowdLevelL - g0L) / CHUNK;
      const stepR = (this.crowdLevelR - g0R) / CHUNK;
      const top = this.crowdTop;
      let lowL = this.crowdLowL;
      let lowR = this.crowdLowR;
      for (let i = 0; i < n; i++) {
        const j = offset + i + 1;
        lowL += ((c[i] as number) - lowL) * top;
        lowR += ((d[i] as number) - lowR) * top;
        left[i] = (left[i] as number) + lowL * (g0L + stepL * j) * lift;
        right[i] = (right[i] as number) + lowR * (g0R + stepR * j) * lift;
      }
      this.crowdLowL = lowL;
      this.crowdLowR = lowR;
    }

    if (this.treesAwake) {
      this.treesL.processBlock(a, c, n);
      this.treesR.processBlock(b, d, n);
      const g0 = this.treesFrom;
      const step = (this.treesLevel - g0) / CHUNK;
      const gust = this.gust * TREES_GAIN;
      for (let i = 0; i < n; i++) {
        const g = (g0 + step * (offset + i + 1)) * gust;
        left[i] = (left[i] as number) + (c[i] as number) * g;
        right[i] = (right[i] as number) + (d[i] as number) * g;
      }
    }

    if (this.birdsAwake) this.renderBirds(left, right, n);

    if (this.cityAwake) {
      this.rumbleL.processBlock(a, c, n);
      this.rumbleR.processBlock(b, d, n);
      this.insects.processBlock(b, a, n); // `a` is free again: reuse it for the insects
      const g0 = this.cityFrom;
      const step = (this.cityLevel - g0) / CHUNK;
      const wave = this.insectWave;
      const night = this.night;
      let hum = this.humPhase;
      let chirp = this.insectPhase;
      const dHum = 100 / this.sampleRate;
      const dChirp = INSECT_HZ / this.sampleRate;
      const table = SINE_TABLE;
      const steps = SINE_STEPS;
      const mask = SINE_MASK;
      for (let i = 0; i < n; i++) {
        const g = g0 + step * (offset + i + 1);
        hum += dHum;
        hum -= Math.floor(hum);
        chirp += dChirp;
        chirp -= Math.floor(chirp);
        // 100, 200 and 300 Hz partials and the 38 Hz insect pulse, each read inline.
        let x = hum * steps;
        let q = x | 0;
        let k = q & mask;
        const h1 =
          (table[k] as number) + (x - q) * ((table[k + 1] as number) - (table[k] as number));
        x = (2 * hum + 0.1) * steps;
        q = x | 0;
        k = q & mask;
        const h2 =
          (table[k] as number) + (x - q) * ((table[k + 1] as number) - (table[k] as number));
        x = (3 * hum + 0.3) * steps;
        q = x | 0;
        k = q & mask;
        const h3 =
          (table[k] as number) + (x - q) * ((table[k + 1] as number) - (table[k] as number));
        x = chirp * steps;
        q = x | 0;
        k = q & mask;
        // One pulse per cycle: (½ + ½ sin)² (a bare sin² would pulse twice per cycle).
        const pulse =
          0.5 +
          0.5 *
            ((table[k] as number) + (x - q) * ((table[k + 1] as number) - (table[k] as number)));
        const tone = (HUM_1 * h1 + HUM_2 * h2 + HUM_3 * h3) * night;
        const insect = (a[i] as number) * INSECT_GAIN * wave * pulse * pulse * night;
        left[i] = (left[i] as number) + g * ((c[i] as number) * RUMBLE_GAIN + tone + insect);
        right[i] =
          (right[i] as number) + g * ((d[i] as number) * RUMBLE_GAIN + 0.9 * tone - insect * 0.6);
      }
      this.humPhase = hum;
      this.insectPhase = chirp;
    }
    this.clock += n;
  }

  /** Once per aligned chunk: move every slow quantity one chunk on. */
  private advanceChunk(): void {
    const sr = this.sampleRate;
    const k = this.kChunk;
    const t = this.clock / sr;
    this.crowdAwake =
      this.crowdTargetL + this.crowdTargetR > 0 || this.crowdLevelL + this.crowdLevelR > 1e-6;
    this.treesAwake = this.treesTarget > 0 || this.treesLevel > 1e-6;
    this.cityAwake = this.cityTarget > 0 || this.cityLevel > 1e-6;
    this.crowdFromL = this.crowdAwake ? this.crowdLevelL : 0;
    this.crowdFromR = this.crowdAwake ? this.crowdLevelR : 0;
    this.treesFrom = this.treesAwake ? this.treesLevel : 0;
    this.cityFrom = this.cityAwake ? this.cityLevel : 0;
    this.crowdLevelL = this.crowdFromL + (this.crowdTargetL - this.crowdFromL) * k;
    this.crowdLevelR = this.crowdFromR + (this.crowdTargetR - this.crowdFromR) * k;
    this.treesLevel = this.treesFrom + (this.treesTarget - this.treesFrom) * k;
    this.cityLevel = this.cityFrom + (this.cityTarget - this.cityFrom) * k;
    this.birdsLevel += (this.birdsTarget - this.birdsLevel) * k;
    this.birdsAwake = this.birdsLevel > 1e-4 || this.birdNotes > 0;
    this.cheer += (this.cheerTarget - this.cheer) * this.kCheerRise;
    this.cheerTarget *= this.cheerFall;
    const swell =
      0.75 + 0.15 * Math.sin(TWO_PI * (0.13 * t)) + 0.1 * Math.sin(TWO_PI * (0.31 * t + 0.4));
    this.crowdLift = CROWD_GAIN * swell * (1 + 1.5 * this.cheer);
    this.gust = 0.55 + 0.45 * Math.sin(TWO_PI * (0.07 * t)) * Math.sin(TWO_PI * (0.19 * t + 0.25));
    this.insectWave = Math.max(0, Math.sin(TWO_PI * (0.11 * t)));
  }

  private renderBirds(left: Float64Array, right: Float64Array, n: number): void {
    const sr = this.sampleRate;
    const note = Math.round(0.07 * sr);
    const gap = Math.round(0.045 * sr);
    const level = this.birdsLevel * BIRD_GAIN;
    const table = SINE_TABLE;
    const steps = SINE_STEPS;
    const mask = SINE_MASK;
    for (let i = 0; i < n; i++) {
      if (this.birdNotes === 0) {
        if (--this.birdWait > 0) continue;
        this.birdNotes = 3 + Math.floor(4 * this.events.unit());
        this.birdHz = 2600 + 1800 * this.events.unit();
        this.birdPan = this.events.unit();
        this.birdAge = 0;
        this.birdWait = Math.round(sr * (1.5 + 4.5 * this.events.unit()));
      }
      if (this.birdAge < note) {
        const u = this.birdAge / note;
        this.birdPhase += (this.birdHz * (1.3 - 0.3 * u)) / sr;
        this.birdPhase -= Math.floor(this.birdPhase);
        // Half-sine envelope over the note, and the tone, both read inline.
        let x = 0.5 * u * steps;
        let q = x | 0;
        let k = q & mask;
        const env =
          (table[k] as number) + (x - q) * ((table[k + 1] as number) - (table[k] as number));
        x = this.birdPhase * steps;
        q = x | 0;
        k = q & mask;
        const tone =
          (table[k] as number) + (x - q) * ((table[k + 1] as number) - (table[k] as number));
        const v = tone * env * level;
        left[i] = (left[i] as number) + v * (1 - this.birdPan);
        right[i] = (right[i] as number) + v * this.birdPan;
      }
      if (++this.birdAge >= note + gap) {
        this.birdAge = 0;
        this.birdNotes--;
        this.birdHz *= 0.94;
      }
    }
  }
}
