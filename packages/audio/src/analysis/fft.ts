/** In-place iterative radix-2 complex FFT. `re` and `im` have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0)
    throw new RangeError('fft needs equal power-of-two lengths');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = (re[b] as number) * cr - (im[b] as number) * ci;
        const xi = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/**
 * Magnitude spectrum of `length` samples from `start`, Hann-windowed and zero-padded to
 * `fftSize`. Bin k is at k * sampleRate / fftSize. Scaled so a full-scale sine reads 1.
 */
export function magnitudeSpectrum(
  signal: ArrayLike<number>,
  start: number,
  length: number,
  fftSize: number,
): Float64Array {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  let windowSum = 0;
  for (let i = 0; i < length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
    re[i] = (signal[start + i] ?? 0) * w;
    windowSum += w;
  }
  fft(re, im);
  const mags = new Float64Array(fftSize / 2 + 1);
  for (let k = 0; k < mags.length; k++) {
    mags[k] = (2 * Math.hypot(re[k] as number, im[k] as number)) / windowSum;
  }
  return mags;
}

export interface SpectralPeak {
  /** Hz, refined by parabolic interpolation on the log magnitude. */
  frequency: number;
  /** Linear magnitude of the peak bin. */
  magnitude: number;
}

/** Strongest bin between `fMin` and `fMax`, refined between bins. */
export function findPeak(
  mags: Float64Array,
  sampleRate: number,
  fMin: number,
  fMax: number,
): SpectralPeak {
  const fftSize = (mags.length - 1) * 2;
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.ceil(fMin / binHz));
  const hi = Math.min(mags.length - 2, Math.floor(fMax / binHz));
  let best = lo;
  for (let k = lo; k <= hi; k++) if ((mags[k] as number) > (mags[best] as number)) best = k;
  const a = Math.log((mags[best - 1] as number) + 1e-300);
  const b = Math.log((mags[best] as number) + 1e-300);
  const c = Math.log((mags[best + 1] as number) + 1e-300);
  const denom = a - 2 * b + c;
  const delta = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
  return { frequency: (best + delta) * binHz, magnitude: mags[best] as number };
}

/** Power-weighted mean frequency between `fMin` and `fMax`, Hz. */
export function spectralCentroid(
  mags: Float64Array,
  sampleRate: number,
  fMin = 20,
  fMax = 20000,
): number {
  const binHz = sampleRate / ((mags.length - 1) * 2);
  let num = 0;
  let den = 0;
  for (let k = Math.ceil(fMin / binHz); k <= Math.min(mags.length - 1, fMax / binHz); k++) {
    const p = (mags[k] as number) ** 2;
    num += p * k * binHz;
    den += p;
  }
  return den > 0 ? num / den : 0;
}

/** Sum of squared magnitudes between `fLow` and `fHigh`, Hz. */
export function bandPower(
  mags: Float64Array,
  sampleRate: number,
  fLow: number,
  fHigh: number,
): number {
  const binHz = sampleRate / ((mags.length - 1) * 2);
  let sum = 0;
  for (let k = Math.ceil(fLow / binHz); k <= Math.min(mags.length - 1, fHigh / binHz); k++) {
    sum += (mags[k] as number) ** 2;
  }
  return sum;
}

/**
 * Short-time spectrum in dB (full-scale sine = 0 dB): `frames` rows of `fftSize/2 + 1` bins.
 */
export function spectrogram(
  signal: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  hop: number,
): { frames: number; bins: number; db: Float32Array; hopSeconds: number; binHz: number } {
  const frames = Math.max(0, Math.floor((signal.length - fftSize) / hop) + 1);
  const bins = fftSize / 2 + 1;
  const db = new Float32Array(frames * bins);
  for (let f = 0; f < frames; f++) {
    const mags = magnitudeSpectrum(signal, f * hop, fftSize, fftSize);
    for (let k = 0; k < bins; k++) db[f * bins + k] = 20 * Math.log10((mags[k] as number) + 1e-12);
  }
  return { frames, bins, db, hopSeconds: hop / sampleRate, binHz: sampleRate / fftSize };
}
