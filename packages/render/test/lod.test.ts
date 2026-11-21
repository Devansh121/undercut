import { describe, expect, it } from 'vitest';
import { lodBlend, ditherCode } from '../src/car/lod';

describe('lodBlend', () => {
  const d = [10, 45];

  it('is one level, fully visible, away from the switch distances', () => {
    expect(lodBlend(5, d, 3)).toEqual([{ level: 0, fade: 1 }]);
    expect(lodBlend(30, d, 3)).toEqual([{ level: 1, fade: 1 }]);
    expect(lodBlend(200, d, 3)).toEqual([{ level: 2, fade: 1 }]);
  });

  it('cross-fades two neighbouring levels across the band, with weights summing to one', () => {
    for (const x of [8.6, 9.5, 10, 10.9, 11.4]) {
      const b = lodBlend(x, d, 3);
      expect(b).toHaveLength(2);
      expect(b[0]?.level).toBe(0);
      expect(b[1]?.level).toBe(1);
      expect((b[0]?.fade ?? 0) + (b[1]?.fade ?? 0)).toBeCloseTo(1, 9);
    }
  });

  it('is continuous: no jump in weight anywhere along the distance', () => {
    let prev = lodBlend(0, d, 3);
    for (let x = 0; x < 60; x += 0.01) {
      const b = lodBlend(x, d, 3);
      const w = (list: typeof b, level: number): number =>
        list.find((e) => e.level === level)?.fade ?? 0;
      for (const level of [0, 1, 2])
        expect(Math.abs(w(b, level) - w(prev, level))).toBeLessThan(0.02);
      prev = b;
    }
  });

  it('uses the first level everywhere when there is one distance at 0 (Mobile preset)', () => {
    expect(lodBlend(3, [0, 25], 2)).toEqual([{ level: 1, fade: 1 }]);
  });
});

describe('ditherCode', () => {
  it('encodes complementary coverage for the outgoing and incoming level', () => {
    // A pixel with threshold b is drawn by exactly one of the pair.
    for (const f of [0, 0.25, 0.5, 0.9, 1]) {
      for (const b of [0, 0.1, 0.49, 0.5, 0.75, 0.99]) {
        const visible = (code: number): boolean => (code >= 0 ? b < code : b >= code + 2);
        expect(Number(visible(ditherCode(f, true))) + Number(visible(ditherCode(f, false)))).toBe(
          1,
        );
      }
    }
  });
});
