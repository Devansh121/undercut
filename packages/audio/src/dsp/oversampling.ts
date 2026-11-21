/**
 * 4× polyphase interpolator for true-peak estimates (the BS.1770-4 Annex 2 method), shared
 * by the limiter's detector and the true-peak meter so they agree.
 * Blackman-windowed sinc, 64 taps, cut off at the input Nyquist frequency.
 */
export const OVERSAMPLE = 4;
export const TAPS_PER_PHASE = 16;
/** Delay of the interpolated points behind the newest input sample, in input samples. */
export const INTERPOLATOR_DELAY = 8;

/** Coefficients, phase-major: phase p, tap t at `[p * TAPS_PER_PHASE + t]`. */
export const POLYPHASE: Float64Array = (() => {
  const total = OVERSAMPLE * TAPS_PER_PHASE;
  const centre = (total - 1) / 2;
  const h = new Float64Array(total);
  for (let n = 0; n < total; n++) {
    const t = (n - centre) / OVERSAMPLE;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const w =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * n) / (total - 1)) +
      0.08 * Math.cos((4 * Math.PI * n) / (total - 1));
    h[n] = sinc * w;
  }
  const out = new Float64Array(total);
  for (let p = 0; p < OVERSAMPLE; p++) {
    for (let t = 0; t < TAPS_PER_PHASE; t++)
      out[p * TAPS_PER_PHASE + t] = h[t * OVERSAMPLE + p] as number;
  }
  return out;
})();
