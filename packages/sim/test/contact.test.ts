import { describe, expect, it } from 'vitest';
import {
  FLAT_SURFACE,
  PATCH_HINTS,
  createPatchSample,
  createSurfaceHint,
  samplePatch,
  tyreVerticalForce,
  type SurfaceHint,
  type SurfaceSample,
  type SurfaceSampler,
} from '../src/index';

const hints: SurfaceHint[] = Array.from({ length: PATCH_HINTS }, createSurfaceHint);

/** A kerb-like transverse ramp: 35 mm over 0.12 m toward −Z (left of a car heading +X). */
const RAMP: SurfaceSampler = {
  sample(_x: number, z: number, _h: SurfaceHint, out: SurfaceSample): void {
    const u = -z;
    const h = u <= 0 ? 0 : u >= 0.12 ? 0.035 : (0.035 * u) / 0.12;
    FLAT_SURFACE.sample(0, 0, _h, out);
    out.height = h;
  },
};

describe('contact patch', () => {
  it('reads flat ground exactly', () => {
    const p = createPatchSample();
    expect(samplePatch(FLAT_SURFACE, 3, -2, 1, 0, 0.32, 0.15, hints, 0, p)).toBe(false);
    expect(p.height).toBe(0);
    expect(p.normalY).toBeCloseTo(1, 12);
    expect(p.grip).toBe(1);
  });

  it('spreads a 35 mm kerb ramp over about the patch width, not the 0.12 m ramp', () => {
    const p = createPatchSample();
    let last = 0;
    let maxSlope = 0;
    const du = 0.001;
    for (let u = -0.4; u <= 0.6; u += du) {
      samplePatch(RAMP, 0, -u, 1, 0, 0.32, 0.15, hints, 0, p);
      if (u > -0.4) maxSlope = Math.max(maxSlope, (p.height - last) / du);
      last = p.height;
    }
    // Point sampling sees 0.035 / 0.12 = 0.29; a 0.32 m box filter at most 0.035 / 0.32 ≈ 0.11.
    expect(maxSlope).toBeLessThan(0.125);
    expect(last).toBeCloseTo(0.035, 9);
  });
});

describe('tyre vertical force', () => {
  const out = { damping: 0 };
  it('pushes only when compressed and never pulls', () => {
    expect(tyreVerticalForce(-0.001, 2, 3e5, 7000, 0.003, out)).toBe(0);
    expect(tyreVerticalForce(0.004, -5, 3e5, 7000, 0.003, out)).toBe(0);
    expect(out.damping).toBeCloseTo(-3e5 * 0.004, 9);
  });

  it('is continuous at first touch whatever the closing speed', () => {
    for (const rate of [-5, -1, 1, 5]) {
      expect(tyreVerticalForce(1e-9, rate, 3e5, 7000, 0.003, out)).toBeLessThan(0.05);
    }
  });

  it('is stiffness plus full carcass damping once the patch has formed', () => {
    expect(tyreVerticalForce(0.007, 0.2, 3e5, 7000, 0.003, out)).toBeCloseTo(2100 + 1400, 9);
    expect(out.damping).toBeCloseTo(1400, 9);
  });
});
