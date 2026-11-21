/** One level of detail to draw for a car, and how much of it (dithered coverage, 0..1). */
export interface LodWeight {
  level: number;
  fade: number;
}

/**
 * Levels of detail by camera distance, with a cross-fade band of `width` metres centred on each
 * switch distance. `distances[i]` is where level i + 1 takes over from level i. A distance of 0
 * means level i is never used. The two levels in a band share pixels by complementary dithering
 * (see `ditherCode`), so the switch shows no pop and no double-drawn frame.
 */
export function lodBlend(dist: number, distances: readonly number[], width: number): LodWeight[] {
  const half = width / 2;
  let level = 0;
  for (let i = 0; i < distances.length; i++) {
    const d = distances[i] as number;
    if (d <= 0) {
      level = i + 1;
      continue;
    }
    if (dist < d - half) return [{ level, fade: 1 }];
    if (dist < d + half) {
      const t = (dist - (d - half)) / width;
      const s = t * t * (3 - 2 * t);
      return [
        { level, fade: 1 - s },
        { level: i + 1, fade: s },
      ];
    }
    level = i + 1;
  }
  return [{ level, fade: 1 }];
}

/**
 * Per-instance dither code: a pixel with ordered-dither threshold b in [0, 1) is drawn when
 * b < code (code ≥ 0), or when b ≥ code + 2 (code < 0). The level fading in with weight `s` gets
 * `s`, the one fading out gets `s − 2` (it keeps exactly the other pixels). Full coverage is 1.
 */
export function ditherCode(s: number, incoming: boolean): number {
  return incoming ? s : s - 2;
}
