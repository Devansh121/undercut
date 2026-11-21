import { describe, expect, it } from 'vitest';
import { CAR_RADIUS_M, ditherCode, lodByPixels, projectedRadius } from '../src/car/lod';

describe('projectedRadius', () => {
  it('follows the contract formula r = R·H / (2·d·tan(fov/2))', () => {
    const r = projectedRadius(30, 60, 1080);
    expect(r).toBeCloseTo((CAR_RADIUS_M * 1080) / (2 * 30 * Math.tan(Math.PI / 6)), 9);
    // Twice as far, half the size.
    expect(projectedRadius(60, 60, 1080)).toBeCloseTo(r / 2, 9);
  });
});

describe('lodByPixels (docs/car-asset.md thresholds, 1.15 hysteresis)', () => {
  const t = [160, 50];

  it('picks High at 160 px and above, Mobile from 50 px, Far below', () => {
    expect(lodByPixels(400, t, 0)).toBe(0);
    expect(lodByPixels(160, t, 0)).toBe(0);
    expect(lodByPixels(159, t, 0)).toBe(1);
    expect(lodByPixels(50, t, 1)).toBe(1);
    expect(lodByPixels(49, t, 1)).toBe(2);
  });

  it('switches back up only at 1.15 × the threshold, so a car on the edge does not flicker', () => {
    expect(lodByPixels(170, t, 1)).toBe(1);
    expect(lodByPixels(183.5, t, 1)).toBe(1);
    expect(lodByPixels(184.1, t, 1)).toBe(0);
    expect(lodByPixels(55, t, 2)).toBe(2);
    expect(lodByPixels(57.6, t, 2)).toBe(1);
    // Once down to Mobile, sizes oscillating around the threshold never toggle back.
    let level = 1;
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      level = lodByPixels(i % 2 ? 158 : 175, t, level);
      seen.add(level);
    }
    expect([...seen]).toEqual([1]);
  });

  it('jumps straight to the right level after a teleport', () => {
    expect(lodByPixels(10, t, 0)).toBe(2);
    expect(lodByPixels(500, t, 2)).toBe(0);
  });

  it('with one threshold uses two levels (Mobile preset: mobile then far)', () => {
    expect(lodByPixels(80, [50], 0)).toBe(0);
    expect(lodByPixels(20, [50], 0)).toBe(1);
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
