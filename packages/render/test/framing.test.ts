import { describe, expect, it } from 'vitest';
import { nextLift } from '../src/framing';

describe('nextLift (chase-camera image shift)', () => {
  it('is never below the target, at any frame rate, so the car never dips into the cluster', () => {
    // A target that keeps rising (camera pulling back as speed builds), sampled at 60 fps and
    // at the 3 fps of software rendering on a CI runner.
    for (const dt of [1 / 60, 0.33]) {
      let lift = 0;
      for (let i = 0; i < 40; i++) {
        const target = 40 + i * 3;
        lift = nextLift(lift, target, dt);
        expect(lift).toBeGreaterThanOrEqual(target);
      }
    }
  });

  it('eases back down when the target falls, instead of jumping', () => {
    const a = nextLift(100, 0, 1 / 60);
    expect(a).toBeLessThan(100);
    expect(a).toBeGreaterThan(90);
    let lift = 100;
    for (let i = 0; i < 120; i++) lift = nextLift(lift, 0, 1 / 60);
    expect(lift).toBeLessThan(1);
  });

  it('holds still while frozen (dt 0) unless the target needs more', () => {
    expect(nextLift(50, 10, 0)).toBe(50);
    expect(nextLift(50, 70, 0)).toBe(70);
  });
});
