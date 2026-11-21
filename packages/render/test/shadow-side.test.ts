import { describe, expect, it } from 'vitest';
import { CAR_AO_GLSL } from '../src/car/car-shader';
import { GROUND_ALBEDO, groundBounce } from '../src/lighting/time-of-day';

describe('car occlusion is applied once', () => {
  it('reflections are attenuated by the specular-occlusion curve only, not again by the raw AO', () => {
    const lines = CAR_AO_GLSL.split('\n').filter((l) => l.includes('indirectSpecular *='));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/bakedAo/);
    // Clear coat: the baked AO once, not squared.
    expect(CAR_AO_GLSL).not.toMatch(/bakedAo\s*\*\s*bakedAo/);
  });
});

describe('ground bounce', () => {
  const meta = {
    sun: {
      present: true,
      elevationDeg: 48,
      u: 0.6,
      irradiance: [4.3, 4.36, 3.96] as [number, number, number],
      solidAngleSr: 4e-4,
    },
    skyIrradiance: [1.39, 1.59, 2.26] as [number, number, number],
  };

  it('is the light falling on the circuit times the ground albedo, over pi', () => {
    const g = groundBounce(meta, { sunScale: 1, skyIntensity: 1 });
    const s = Math.sin((48 * Math.PI) / 180);
    expect(g[0]).toBeCloseTo((GROUND_ALBEDO[0] * (4.3 * s + 1.39)) / Math.PI, 6);
    expect(g[1]).toBeCloseTo((GROUND_ALBEDO[1] * (4.36 * s + 1.59)) / Math.PI, 6);
  });

  it('is never black in daylight, and falls with the light at night', () => {
    const day = groundBounce(meta, { sunScale: 1, skyIntensity: 1 });
    expect(Math.min(...day)).toBeGreaterThan(0.05);
    const night = groundBounce(meta, { sunScale: 0, skyIntensity: 0.06 });
    expect(Math.max(...night)).toBeLessThan(0.01);
  });
});

describe('dark materials keep real-world albedo', () => {
  it('bare carbon and tyre rubber are not darker than about 2.5 % reflectance', async () => {
    const { Color } = await import('three');
    const { CARBON, RUBBER_ALBEDO } = await import('../src/car/livery');
    const c = new Color(CARBON);
    expect(Math.min(c.r, c.g, c.b)).toBeGreaterThanOrEqual(0.022);
    expect(RUBBER_ALBEDO).toBeGreaterThanOrEqual(0.025);
  });

  it('the baked AO darkens albedo by at most three quarters of its depth', async () => {
    const { CAR_COLOR_GLSL, BAKED_AO_ALBEDO_STRENGTH } = await import('../src/car/car-shader');
    expect(BAKED_AO_ALBEDO_STRENGTH).toBeLessThanOrEqual(0.75);
    expect(CAR_COLOR_GLSL).toMatch(/mix\(/);
  });
});

describe("albedo floor for the asset's near-black materials", () => {
  it('lifts a 0.3 % base colour to 2.5 % keeping its hue, and leaves brighter colours alone', async () => {
    const { Color } = await import('three');
    const { ALBEDO_FLOOR, liftAlbedo } = await import('../src/car/car-assets');
    const dark = liftAlbedo(new Color(0.003, 0.004, 0.004), ALBEDO_FLOOR);
    expect(Math.min(dark.r, dark.g, dark.b)).toBeCloseTo(ALBEDO_FLOOR, 6);
    expect(dark.g / dark.r).toBeCloseTo(0.004 / 0.003, 6);
    const paint = liftAlbedo(new Color(0.26, 0.28, 0.3), ALBEDO_FLOOR);
    expect(paint.toArray()).toEqual(new Color(0.26, 0.28, 0.3).toArray());
  });
});
