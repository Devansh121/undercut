import { pulseTables, TABLE_SIZE } from './pulse-tables';

/**
 * Other cars' engines: a cheaper model than the player's. One table holds the whole six-pulse
 * train of a V6 cycle (the player's voice reads six single-cylinder tables with per-cylinder
 * trims, jitter, cuts, turbo and MGU-K layers); a part-load and a full-load train are mixed by
 * throttle, and combustion noise is gated by the pulses. Space is applied per voice: distance
 * gain, air absorption, interaural time difference, a level pan and a head-shadow low-pass
 * on the far ear and for sources behind. About 30 multiply-adds per sample.
 */

export interface TrainTables {
  /** Part-load six-pulse train over one 720° cycle, zero mean, peak 1. */
  soft: Float32Array;
  /** Full-load six-pulse train. */
  hard: Float32Array;
}

const trainCache = new Map<number, TrainTables>();

/**
 * Sum of six copies of a single-cylinder table spaced 1/6 cycle apart, built in the frequency
 * domain: the sum keeps exactly the harmonics that are multiples of 6 (times 6) and cancels
 * the rest, so the train is as band-limited as the table it comes from. The mean is dropped.
 */
function train(table: Float32Array, harmonics: number): Float32Array {
  const n = TABLE_SIZE;
  const out = new Float64Array(n);
  for (let h = 6; h <= harmonics; h += 6) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const w = (2 * Math.PI * h * t) / n;
      re += (table[t] as number) * Math.cos(w);
      im += (table[t] as number) * Math.sin(w);
    }
    re *= 2 / n;
    im *= 2 / n;
    for (let t = 0; t < n; t++) {
      const w = (2 * Math.PI * h * t) / n;
      out[t] = (out[t] as number) + re * Math.cos(w) + im * Math.sin(w);
    }
  }
  let peak = 0;
  for (let t = 0; t < n; t++) peak = Math.max(peak, Math.abs(out[t] as number));
  const result = new Float32Array(n + 1);
  for (let t = 0; t < n; t++) result[t] = (out[t] as number) / (peak || 1);
  result[n] = result[0] as number;
  return result;
}

/** Train tables for a sample rate; built once per harmonic count and shared. */
export function trainTables(sampleRate: number): TrainTables {
  const single = pulseTables(sampleRate);
  let tables = trainCache.get(single.harmonics);
  if (!tables) {
    tables = {
      soft: train(single.soft, single.harmonics),
      hard: train(single.hard, single.harmonics),
    };
    trainCache.set(single.harmonics, tables);
  }
  return tables;
}

/** Woodworth's maximum interaural time difference for an 8.75 cm head radius, s. */
export const MAX_ITD = 0.00066;
/** Level-pan width: 0 is mono, 1 is hard left/right for a source fully to the side. */
export const PAN_WIDTH = 0.7;
/** Distance below which the gain stops rising, m (the "inverse" distance model's reference). */
export const REFERENCE_DISTANCE = 6;
/** Opponent level at the reference distance, full throttle. */
export const OPPONENT_LEVEL = 0.11;
/** Doppler ratio bounds: closing or opening faster than about 69–86 m/s saturates. */
export const DOPPLER_MIN = 0.8;
export const DOPPLER_MAX = 1.25;
const SPEED_OF_SOUND = 343;

/**
 * Air absorption as a one-pole low-pass corner, Hz: open at the reference distance, about
 * 1.9 kHz at 150 m, never below 1.8 kHz. At 150 m that takes about 7 dB off 4 kHz and 12 dB off
 * 8 kHz, against roughly 5 and 15 dB for air at 20 °C and 50 % humidity (ISO 9613-1).
 */
export function airCorner(distance: number): number {
  return Math.max(1800, Math.min(20000, 20000 / (1 + Math.max(0, distance - 6) / 15)));
}

/** Distance gain, inverse model: 1 inside the reference distance, −6 dB per doubling outside. */
export function distanceGain(distance: number): number {
  return REFERENCE_DISTANCE / Math.max(REFERENCE_DISTANCE, distance);
}

/** Doppler ratio from the radial velocity (positive while the source moves away), bounded. */
export function dopplerRatio(radialVelocity: number): number {
  const r = SPEED_OF_SOUND / (SPEED_OF_SOUND + radialVelocity);
  return Math.max(DOPPLER_MIN, Math.min(DOPPLER_MAX, r));
}

/** One-pole low-pass coefficient for a corner frequency. */
function poleFor(corner: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * Math.min(corner, 0.45 * sampleRate)) / sampleRate);
}

/** One opponent's voice. Fixed per car slot, so phase never resets when the pool changes. */
export class OpponentVoice {
  // Targets, set at the scene rate.
  targetGain = 0;
  targetHz = 0;
  targetDoppler = 1;
  targetLoad = 0;
  targetDelayL = 0;
  targetDelayR = 0;
  targetPanL = 0.7071;
  targetPanR = 0.7071;
  targetPoleL = 1;
  targetPoleR = 1;
  /** Distance from the listener at the last scene update, m (Infinity when absent). */
  distance = Infinity;
  // Smoothed state.
  gain = 0;
  hz = 0;
  doppler = 1;
  load = 0;
  delayL = 0;
  delayR = 0;
  panL = 0.7071;
  panR = 0.7071;
  poleL = 1;
  poleR = 1;
  lowL = 0;
  lowR = 0;
  phase = 0;
  noise = 1;
  write = 0;
  awake = false;
  private readonly ring: Float64Array;
  private readonly mask: number;
  private readonly sampleRate: number = 48_000;
  private readonly tables: TrainTables;

  constructor(sampleRate: number, seed: number) {
    this.sampleRate = sampleRate;
    this.tables = trainTables(sampleRate);
    let size = 4;
    while (size < MAX_ITD * sampleRate + 4) size *= 2;
    this.ring = new Float64Array(size);
    this.mask = size - 1;
    this.noise = seed >>> 0 || 0x2545f491;
  }

  /**
   * Point the voice at a car: six values from `car[at]` on, as in a packed scene: listener-
   * relative position (x forward, z right) and velocity in m and m/s, engine speed in rad/s,
   * throttle 0–1, all already range-checked. Set `targetGain` (the pool's level for the slot)
   * first. The values travel in the array, not as arguments: a call that is not inlined boxes
   * every fractional argument, and this runs on the audio thread at frame rate.
   */
  aim(car: Float64Array, at: number): void {
    const x = car[at] as number;
    const z = car[at + 1] as number;
    const vx = car[at + 2] as number;
    const vz = car[at + 3] as number;
    const engineSpeed = car[at + 4] as number;
    const throttle = car[at + 5] as number;
    const d = Math.sqrt(x * x + z * z);
    const r = Math.max(1, d);
    this.targetHz = engineSpeed / (4 * Math.PI); // cycle frequency, rpm / 120
    this.targetLoad = throttle;
    this.targetDoppler = dopplerRatio((x * vx + z * vz) / r);
    const lateral = Math.max(-1, Math.min(1, z / r));
    const behind = Math.max(0, -x / r);
    // Interaural time difference: the far ear hears the source later.
    const itd = MAX_ITD * Math.abs(lateral) * this.sampleRate;
    this.targetDelayL = lateral > 0 ? itd : 0;
    this.targetDelayR = lateral < 0 ? itd : 0;
    // Equal-power level pan, narrowed so a car to the side still reaches both ears.
    const angle = ((PAN_WIDTH * lateral + 1) * Math.PI) / 4;
    this.targetPanL = Math.cos(angle);
    this.targetPanR = Math.sin(angle);
    // Head shadow (far ear: corner down to 2.4 kHz) and pinna shadow behind (down to 3 kHz),
    // in series with air absorption: corners add as 1/f.
    const air = airCorner(d);
    const earL = 20000 * (1 - 0.88 * Math.max(0, lateral)) * (1 - 0.85 * behind);
    const earR = 20000 * (1 - 0.88 * Math.max(0, -lateral)) * (1 - 0.85 * behind);
    const cornerL = 1 / (1 / air + 1 / earL);
    const cornerR = 1 / (1 / air + 1 / earR);
    this.targetPoleL = poleFor(cornerL, this.sampleRate);
    this.targetPoleR = poleFor(cornerR, this.sampleRate);
    this.distance = d;
  }

  silence(): void {
    this.targetGain = 0;
    this.distance = Infinity;
  }

  /**
   * Decide whether the voice runs for the next chunk. Call on aligned chunk boundaries only, so
   * sleeping is deterministic. A voice that wakes starts at its target pitch, place and tone
   * (only its gain fades in), so a car entering the pool does not sweep up from silence.
   */
  wake(): boolean {
    const awake = this.targetGain > 0 || this.gain > 1e-7;
    if (awake && !this.awake) {
      this.hz = this.targetHz;
      this.doppler = this.targetDoppler;
      this.load = this.targetLoad;
      this.delayL = this.targetDelayL;
      this.delayR = this.targetDelayR;
      this.panL = this.targetPanL;
      this.panR = this.targetPanR;
      this.poleL = this.targetPoleL;
      this.poleR = this.targetPoleR;
    }
    if (!awake) this.gain = 0;
    this.awake = awake;
    return awake;
  }

  /** Add `n` samples into the bus; `k` is the per-sample smoothing coefficient. */
  render(left: Float64Array, right: Float64Array, n: number, k: number): void {
    if (!this.awake) return;
    const soft = this.tables.soft;
    const hard = this.tables.hard;
    const ring = this.ring;
    const mask = this.mask;
    const invSr = 1 / this.sampleRate;
    let gain = this.gain;
    let hz = this.hz;
    let doppler = this.doppler;
    let load = this.load;
    let delayL = this.delayL;
    let delayR = this.delayR;
    let panL = this.panL;
    let panR = this.panR;
    let poleL = this.poleL;
    let poleR = this.poleR;
    let lowL = this.lowL;
    let lowR = this.lowR;
    let phase = this.phase;
    let s = this.noise;
    let w = this.write;
    const tGain = this.targetGain;
    const tHz = this.targetHz;
    const tDoppler = this.targetDoppler;
    const tLoad = this.targetLoad;
    const tDelayL = this.targetDelayL;
    const tDelayR = this.targetDelayR;
    const tPanL = this.targetPanL;
    const tPanR = this.targetPanR;
    const tPoleL = this.targetPoleL;
    const tPoleR = this.targetPoleR;
    for (let i = 0; i < n; i++) {
      gain += (tGain - gain) * k;
      hz += (tHz - hz) * k;
      doppler += (tDoppler - doppler) * k;
      load += (tLoad - load) * k;
      delayL += (tDelayL - delayL) * k;
      delayR += (tDelayR - delayR) * k;
      panL += (tPanL - panL) * k;
      panR += (tPanR - panR) * k;
      poleL += (tPoleL - poleL) * k;
      poleR += (tPoleR - poleR) * k;
      phase += hz * doppler * invSr;
      phase -= Math.floor(phase);
      const index = phase * TABLE_SIZE;
      const i0 = index | 0;
      const f = index - i0;
      const a = (soft[i0] as number) + ((soft[i0 + 1] as number) - (soft[i0] as number)) * f;
      const b = (hard[i0] as number) + ((hard[i0 + 1] as number) - (hard[i0] as number)) * f;
      let x = a + (b - a) * load;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      const noise = s / 2147483648 - 1;
      x += noise * (x > 0 ? x : 0) * 0.35 * load;
      ring[w] = x * (0.4 + 0.6 * load) * gain;
      // Fractional delay reads, linear interpolation.
      const pl = w - delayL;
      const jl = Math.floor(pl);
      const fl = pl - jl;
      const xl0 = ring[jl & mask] as number;
      const yl = xl0 + ((ring[(jl + 1) & mask] as number) - xl0) * fl;
      const pr = w - delayR;
      const jr = Math.floor(pr);
      const fr = pr - jr;
      const xr0 = ring[jr & mask] as number;
      const yr = xr0 + ((ring[(jr + 1) & mask] as number) - xr0) * fr;
      lowL += (yl - lowL) * poleL;
      lowR += (yr - lowR) * poleR;
      left[i] = (left[i] as number) + lowL * panL;
      right[i] = (right[i] as number) + lowR * panR;
      w = (w + 1) & mask;
    }
    this.gain = gain;
    this.hz = hz;
    this.doppler = doppler;
    this.load = load;
    this.delayL = delayL;
    this.delayR = delayR;
    this.panL = panL;
    this.panR = panR;
    this.poleL = poleL;
    this.poleR = poleR;
    this.lowL = Number.isFinite(lowL) ? lowL : 0;
    this.lowR = Number.isFinite(lowR) ? lowR : 0;
    this.phase = phase;
    this.noise = s;
    this.write = w;
  }
}
