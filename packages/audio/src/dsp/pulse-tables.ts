/**
 * Exhaust pulse wavetables. One table holds one cylinder's pressure pulse over a full
 * 720° four-stroke cycle. The engine voice reads six of them, offset by the firing order.
 *
 * Each table is built by Fourier synthesis with a fixed number of harmonics of the cycle
 * frequency (plus its mean), so it is band-limited by construction: with `harmonics` chosen from the sample
 * rate, nothing aliases up to the highest engine speed the voice supports.
 */

export const TABLE_SIZE = 2048;

export interface PulseTables {
  /** Part-load pulse: wide and round, few harmonics. */
  soft: Float32Array;
  /** Full-load pulse: steep rise and a reflected negative wave, many harmonics. */
  hard: Float32Array;
  /** Positive envelope of the combustion event, for modulating combustion noise. */
  burst: Float32Array;
  harmonics: number;
}

/** Highest cycle frequency (rpm / 120) the tables must not alias at: 15 000 rpm. */
const MAX_CYCLE_HZ = 125;
const MAX_HARMONICS = 96;

/** Beta-like bump on [0, 1]: x^a (1-x)^b, scaled to peak 1. Zero outside. */
function bump(x: number, a: number, b: number): number {
  if (x <= 0 || x >= 1) return 0;
  const peakX = a / (a + b);
  const peak = Math.pow(peakX, a) * Math.pow(1 - peakX, b);
  return (Math.pow(x, a) * Math.pow(1 - x, b)) / peak;
}

/**
 * Blowdown pulse: a rise with time constant `rise` and an exponential decay with `decay`,
 * both as fractions of the 720° cycle. Its spectrum is flat up to about 1 / (2π·decay)
 * cycles and falls at 6 dB per octave above, and twice as fast above 1 / (2π·rise).
 */
function blowdown(u: number, rise: number, decay: number): number {
  if (u <= 0) return 0;
  const r = 1 - Math.exp(-u / rise);
  return r * r * Math.exp(-u / decay);
}

/** Part load: a slow rise and a long decay, so the harmonics fall away quickly. */
function softShape(u: number): number {
  return blowdown(u, 0.012, 0.05);
}

/** Full load: a near-instant rise and a short decay, rich up to the band limit. */
function hardShape(u: number): number {
  return blowdown(u, 0.0012, 0.02);
}

/**
 * Where each pulse starts in its cylinder's cycle. The voice changes a cylinder's gain when
 * its phase wraps; starting the pulse well after the wrap means the gain always changes
 * while that cylinder is quiet, so ignition cuts and roughness never step the waveform.
 */
export const PULSE_START = 0.35;

/** Fourier-resynthesise `shape` with `n` harmonics, Lanczos-smoothed, peak 1. */
function synthesise(shape: (u: number) => number, n: number): Float32Array {
  const m = 8192;
  const samples = new Float64Array(m);
  let mean = 0;
  for (let j = 0; j < m; j++) {
    const v = shape(j / m - PULSE_START);
    samples[j] = v;
    mean += v / m;
  }
  // Keep the mean: the pulse then rests at zero between events. The voice's DC blocker
  // removes it after the cylinders are summed.
  const out = new Float64Array(TABLE_SIZE).fill(mean);
  for (let k = 1; k <= n; k++) {
    let re = 0;
    let im = 0;
    for (let j = 0; j < m; j++) {
      const w = (2 * Math.PI * k * j) / m;
      const s = samples[j] as number;
      re += s * Math.cos(w);
      im += s * Math.sin(w);
    }
    const x = (Math.PI * k) / (n + 1);
    const sigma = Math.sin(x) / x;
    re *= (2 / m) * sigma;
    im *= (2 / m) * sigma;
    for (let t = 0; t < TABLE_SIZE; t++) {
      const w = (2 * Math.PI * k * t) / TABLE_SIZE;
      out[t] = (out[t] as number) + re * Math.cos(w) + im * Math.sin(w);
    }
  }
  return normalise(out);
}

function normalise(values: Float64Array): Float32Array {
  let peak = 0;
  for (const v of values) peak = Math.max(peak, Math.abs(v));
  // One guard sample at the end so linear interpolation never wraps.
  const table = new Float32Array(TABLE_SIZE + 1);
  for (let t = 0; t < TABLE_SIZE; t++) table[t] = (values[t] as number) / peak;
  table[TABLE_SIZE] = table[0] as number;
  return table;
}

const cache = new Map<number, PulseTables>();

/** Tables for a sample rate. Built once per harmonic count and shared. */
export function pulseTables(sampleRate: number): PulseTables {
  const harmonics = Math.max(
    8,
    Math.min(MAX_HARMONICS, Math.floor((0.45 * sampleRate) / MAX_CYCLE_HZ)),
  );
  let tables = cache.get(harmonics);
  if (!tables) {
    const burst = new Float64Array(TABLE_SIZE);
    for (let t = 0; t < TABLE_SIZE; t++) {
      burst[t] = bump((t / TABLE_SIZE - PULSE_START) / 0.07, 2, 4);
    }
    tables = {
      soft: synthesise(softShape, harmonics),
      hard: synthesise(hardShape, harmonics),
      burst: normalise(burst),
      harmonics,
    };
    cache.set(harmonics, tables);
  }
  return tables;
}
