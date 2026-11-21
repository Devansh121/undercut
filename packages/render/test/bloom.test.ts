import { describe, expect, it } from 'vitest';
import { bloomThreshold, blooms } from '../src/pipeline/bloom';
import { QUALITY } from '../src/quality';
import { MONZA_AFTERNOON, NIGHT_FLOODLIT } from '../src/lighting/time-of-day';

describe('bloom threshold', () => {
  it('is the preset value in scene-linear units whatever the exposure', () => {
    const q = QUALITY.high;
    for (const exposure of [MONZA_AFTERNOON.exposure, NIGHT_FLOODLIT.exposure, 0.1, 4]) {
      expect(bloomThreshold(q, exposure)).toBe(q.bloom.threshold);
    }
  });

  it('the same scene values bloom in the afternoon and at night', () => {
    const q = QUALITY.high;
    for (const radiance of [1, 4, 7.9, 8.1, 20, 400]) {
      expect(blooms(radiance, q, MONZA_AFTERNOON.exposure)).toBe(
        blooms(radiance, q, NIGHT_FLOODLIT.exposure),
      );
    }
    // Sunlit white bodywork (about 1.2) never blooms; the sun disc and a hot brake disc do.
    expect(blooms(1.2, q, 0.74)).toBe(false);
    expect(blooms(500, q, 0.74)).toBe(true);
  });
});
