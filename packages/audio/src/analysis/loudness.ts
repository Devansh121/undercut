import { OVERSAMPLE, POLYPHASE, TAPS_PER_PHASE } from '../dsp/oversampling';

/**
 * Loudness and level measures for rendered audio.
 *
 * `integratedLoudness` follows ITU-R BS.1770-4: K-weighting (a high-shelf pre-filter and the
 * RLB high-pass, designed for any sample rate by the bilinear transform), 400 ms blocks with
 * 75 % overlap, an absolute gate at -70 LUFS and a relative gate 10 LU below the gated mean.
 * Left and right are weighted 1.0. The result is in LUFS (LKFS).
 */

interface Sos {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting stages for a sample rate. */
export function kWeightingFilters(sampleRate: number): [Sos, Sos] {
  // Stage 1: high shelf, +4 dB above about 1.7 kHz (head acoustics).
  const g = 3.999843853973347;
  const fShelf = 1681.974450955533;
  const q0 = 0.7071752369554196;
  let k = Math.tan((Math.PI * fShelf) / sampleRate);
  const vh = Math.pow(10, g / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1 + k / q0 + k * k;
  const shelf: Sos = {
    b0: (vh + (vb * k) / q0 + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q0 + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q0 + k * k) / a0,
  };
  // Stage 2: RLB high-pass at about 38 Hz.
  const fHighpass = 38.13547087602444;
  const qHighpass = 0.5003270373238773;
  k = Math.tan((Math.PI * fHighpass) / sampleRate);
  a0 = 1 + k / qHighpass + k * k;
  const highpass: Sos = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / qHighpass + k * k) / a0,
  };
  return [shelf, highpass];
}

function filter(x: ArrayLike<number>, s: Sos): Float64Array {
  const y = new Float64Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    const yi = s.b0 * xi + z1;
    z1 = s.b1 * xi - s.a1 * yi + z2;
    z2 = s.b2 * xi - s.a2 * yi;
    y[i] = yi;
  }
  return y;
}

/** Integrated loudness, LUFS. Returns -Infinity for silence. */
export function integratedLoudness(
  channels: readonly ArrayLike<number>[],
  sampleRate: number,
): number {
  const [shelf, highpass] = kWeightingFilters(sampleRate);
  const weighted = channels.map((c) => filter(filter(c, shelf), highpass));
  const length = channels[0]?.length ?? 0;
  const block = Math.round(0.4 * sampleRate);
  const step = Math.round(0.1 * sampleRate);
  const powers: number[] = [];
  for (let start = 0; start + block <= length; start += step) {
    let sum = 0;
    for (const w of weighted) {
      let ms = 0;
      for (let i = start; i < start + block; i++) ms += (w[i] as number) ** 2;
      sum += ms / block;
    }
    powers.push(sum);
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const absGated = powers.filter((p) => lufs(p) > -70);
  if (absGated.length === 0) return -Infinity;
  const relGate = lufs(absGated.reduce((a, b) => a + b, 0) / absGated.length) - 10;
  const gated = absGated.filter((p) => lufs(p) > relGate);
  return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** RMS level of the whole signal, dBFS (full-scale sine = -3.01 dBFS). */
export function rmsDbfs(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] as number) ** 2;
  return 10 * Math.log10(s / Math.max(1, x.length) + 1e-30);
}

/** Largest absolute sample. */
export function samplePeak(x: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i] as number));
  return p;
}

/** Mean value (DC offset). */
export function dcOffset(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] as number;
  return s / Math.max(1, x.length);
}

/** Largest |x[n] - x[n-1]| for n in [start, end). The click measure. */
export function maxStep(x: ArrayLike<number>, start = 1, end = x.length): number {
  let m = 0;
  for (let i = Math.max(1, start); i < Math.min(end, x.length); i++) {
    m = Math.max(m, Math.abs((x[i] as number) - (x[i - 1] as number)));
  }
  return m;
}

/**
 * True peak (BS.1770-4 Annex 2 method): the largest absolute value of the signal
 * oversampled 4x. Linear; 20·log10 gives dBTP.
 */
export function truePeak(x: ArrayLike<number>): number {
  let peak = samplePeak(x);
  // Run the interpolator past the last sample (as if followed by silence) so that an
  // overshoot after the final samples is measured too.
  const end = x.length + TAPS_PER_PHASE;
  for (let n = 0; n < end; n++) {
    for (let p = 0; p < OVERSAMPLE; p++) {
      let acc = 0;
      for (let t = 0; t < TAPS_PER_PHASE; t++) {
        const idx = n - t;
        if (idx >= 0 && idx < x.length)
          acc += (POLYPHASE[p * TAPS_PER_PHASE + t] as number) * (x[idx] as number);
      }
      const a = Math.abs(acc);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

export function toDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-12));
}
