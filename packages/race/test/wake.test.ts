import { describe, expect, it } from 'vitest';
import { wakeStrength } from '../src/session/wake';

const car = { x: 0, z: 0, yaw: 0, vx: 70 };

describe('slipstream geometry', () => {
  it('is strongest close behind, fades with distance and vanishes outside the wake', () => {
    const close = wakeStrength({ ...car, x: -15 }, car);
    expect(close).toBeGreaterThan(0);
    expect(wakeStrength({ ...car, x: -60 }, car)).toBeLessThan(close);
    expect(wakeStrength({ ...car, x: -120 }, car)).toBe(0);
    expect(wakeStrength({ ...car, x: -15, z: 5 }, car)).toBe(0);
    expect(wakeStrength({ ...car, x: 15 }, car)).toBe(0);
  });

  it('does not draft a stopped, sideways or oppositely facing car', () => {
    expect(wakeStrength({ ...car, x: -15 }, { ...car, vx: 0 })).toBe(0);
    expect(wakeStrength({ ...car, x: -15, yaw: 0.5 }, car)).toBe(0);
    expect(wakeStrength({ ...car, x: -15, yaw: Math.PI }, car)).toBe(0);
  });

  it('rotates with the leading car in the world frame', () => {
    const yaw = 1.2;
    expect(
      wakeStrength({ ...car, x: -20 * Math.cos(yaw), z: 20 * Math.sin(yaw), yaw }, { ...car, yaw }),
    ).toBeCloseTo(wakeStrength({ ...car, x: -20 }, car), 12);
  });
});
