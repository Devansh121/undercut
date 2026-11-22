/**
 * Sine by table, for the oscillators that run on every sample (turbo, MGU-K and gear whine
 * partials). One turn in `SINE_STEPS` steps plus a guard point, read with linear
 * interpolation. The largest error is (2π / SINE_STEPS)² / 8 = 2.9e-7 of the partial's
 * amplitude (−131 dB); at the layers' levels that is below −165 dBFS, under the resolution
 * of a 24-bit output. `Math.sin` costs several times as much and was the largest cost in
 * the voices.
 *
 * Read it inline (a function returning a fractional number would box it on the audio
 * thread), with the table and both constants copied into locals first (in Node the module
 * runner turns each imported binding into a property read), and the phase `p` in turns,
 * p ≥ 0 and p × SINE_STEPS < 2³¹:
 *
 *     const x = p * steps;
 *     const i = x | 0;
 *     const f = x - i;
 *     const k = i & mask;
 *     const s = table[k] + f * (table[k + 1] - table[k]);
 */
export const SINE_STEPS = 4096;
export const SINE_MASK = SINE_STEPS - 1;

export const SINE_TABLE: Float64Array = (() => {
  const t = new Float64Array(SINE_STEPS + 1);
  for (let k = 0; k < SINE_STEPS; k++) t[k] = Math.sin((2 * Math.PI * k) / SINE_STEPS);
  t[SINE_STEPS] = t[0] as number;
  return t;
})();
