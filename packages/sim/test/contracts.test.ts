import { describe, expect, it } from 'vitest';
import {
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  SurfaceKind,
  createSurfaceHint,
  createSurfaceSample,
  resetControlInput,
  type ControlInput,
} from '../src/index';

describe('control input contract', () => {
  it('neutral input asks for nothing and cannot be mutated', () => {
    expect(NEUTRAL_INPUT).toEqual({
      steer: 0,
      throttle: 0,
      brake: 0,
      gearShift: 0,
      drs: false,
      overtake: false,
      pitLimiter: false,
    });
    expect(Object.isFrozen(NEUTRAL_INPUT)).toBe(true);
  });

  it('resetControlInput clears every field in place', () => {
    const input: ControlInput = {
      steer: -0.4,
      throttle: 1,
      brake: 0.3,
      gearShift: 1,
      drs: true,
      overtake: true,
      pitLimiter: true,
    };
    const returned = resetControlInput(input);
    expect(returned).toBe(input);
    expect(input).toEqual(NEUTRAL_INPUT);
  });
});

describe('surface contract', () => {
  it('surface kinds are distinct small integers', () => {
    const values = Object.values(SurfaceKind);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(256);
    }
  });

  it('the flat surface overwrites every field of a reused sample', () => {
    const out = createSurfaceSample();
    out.height = 12;
    out.normalX = 0.6;
    out.normalY = 0.8;
    out.grip = 0.3;
    out.drag = 9;
    out.roughness = 0.02;
    out.kind = SurfaceKind.Gravel;
    out.s = 100;
    out.d = -3;
    FLAT_SURFACE.sample(250, -40, createSurfaceHint(), out);
    expect(out.height).toBe(0);
    expect([out.normalX, out.normalY, out.normalZ]).toEqual([0, 1, 0]);
    expect(out.grip).toBe(1);
    expect(out.drag).toBe(1);
    expect(out.roughness).toBe(0);
    expect(out.kind).toBe(SurfaceKind.Asphalt);
    expect(Number.isNaN(out.s)).toBe(true);
    expect(Number.isNaN(out.d)).toBe(true);
  });

  it('a fresh hint starts unpositioned', () => {
    expect(createSurfaceHint().index).toBe(-1);
  });
});
