/**
 * Levels of detail for cars by projected size, as docs/car-asset.md defines them: a bounding
 * sphere of radius 3.0 m about the car origin, its projected radius in pixels, a threshold per
 * switch (High ≥ 160 px, Mobile ≥ 50 px on the High preset), switching down at the threshold and
 * back up only at 1.15 × it. Switches cross-fade over a short time by complementary dithering
 * (`ditherCode`), so a switch shows no pop and no doubled frame.
 */
export const CAR_RADIUS_M = 3.0;
export const LOD_HYSTERESIS = 1.15;
/** Seconds a level switch takes to cross-fade. */
export const LOD_FADE_S = 0.3;

/** Projected radius in pixels of the car's bounding sphere at distance `d` (m). */
export function projectedRadius(d: number, fovDeg: number, viewportHeight: number): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  return (CAR_RADIUS_M * viewportHeight) / (2 * Math.max(0.01, d) * t);
}

/**
 * Level for a projected radius `px`, given the current level. `thresholds[i]` is the size below
 * which level i + 1 takes over from level i. Going down happens at the threshold; going up only
 * above threshold × 1.15.
 */
export function lodByPixels(px: number, thresholds: readonly number[], current: number): number {
  let level = 0;
  for (let i = 0; i < thresholds.length; i++) {
    const t = thresholds[i] as number;
    // Moving up to level i (from a coarser one) needs the hysteresis margin.
    const up = current > i ? t * LOD_HYSTERESIS : t;
    if (px >= up) return level;
    level = i + 1;
  }
  return level;
}

/**
 * Per-instance dither code: a pixel with ordered-dither threshold b in [0, 1) is drawn when
 * b < code (code ≥ 0), or when b ≥ code + 2 (code < 0). The level fading in with weight `s` gets
 * `s`, the one fading out gets `s − 2` (it keeps exactly the other pixels). Full coverage is 1.
 */
export function ditherCode(s: number, incoming: boolean): number {
  return incoming ? s : s - 2;
}
