import { describe, expect, it } from 'vitest';
import { wakeStrength } from '../src/session/wake';

const lead = { x: 0, z: 0, yaw: 0, vx: 70 };
describe('straight-line tow', () => {
  it('fades with separation and lateral distance', () => {
    const close = wakeStrength({ ...lead, x: -15 }, lead);
    expect(close).toBeGreaterThan(0);
    expect(wakeStrength({ ...lead, x: -60 }, lead)).toBeLessThan(close);
    expect(wakeStrength({ ...lead, x: -15, z: 4 }, lead)).toBe(0);
  });
  it('excludes overlap, a slow leader and cars on another leg of the circuit', () => {
    expect(wakeStrength({ ...lead, x: -4 }, lead)).toBe(0);
    expect(wakeStrength({ ...lead, x: -15 }, { ...lead, vx: 10 })).toBe(0);
    expect(wakeStrength({ ...lead, x: -15, yaw: Math.PI }, lead)).toBe(0);
  });
});
