import { describe, expect, it } from 'vitest';
import { approxEqual, clamp, lerp, wrapAngle } from '../src/math';

describe('math', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
  });

  it('lerp', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it('wrapAngle maps any angle to (-pi, pi]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI / 2 + 4 * Math.PI)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(-Math.PI / 2 - 6 * Math.PI)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('approxEqual', () => {
    expect(approxEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(approxEqual(1, 1.001)).toBe(false);
    expect(approxEqual(1, 1.001, 0.01)).toBe(true);
  });
});
