import { describe, expect, it } from 'vitest';
import { lockExcess, spinExcess } from '../src/driver/feel';

describe('what the driver feels', () => {
  const peak = 0.1;

  it('holds an evenly loaded axle at the peak slip', () => {
    const load = [4000, 4000, 3000, 3000];
    expect(lockExcess([-0.08, -0.08, -0.05, -0.05], load, peak)).toBeLessThan(0);
    expect(lockExcess([-0.12, -0.05, -0.05, -0.05], load, peak)).toBeCloseTo(0.02, 9);
  });

  it('lets a light inside wheel slip further, but never to a lock', () => {
    const load = [5000, 1250, 4000, 4000]; // inside front at a quarter of the outside's load
    // Threshold for the light wheel: peak × min(3, sqrt(4)) = 0.2.
    expect(lockExcess([-0.05, -0.18, -0.05, -0.05], load, peak)).toBeLessThan(0);
    expect(lockExcess([-0.05, -0.25, -0.05, -0.05], load, peak)).toBeCloseTo(0.05, 9);
    expect(lockExcess([-0.05, -1, -0.05, -0.05], [5000, 10, 4000, 4000], peak)).toBeGreaterThan(
      0.5,
    );
  });

  it('holds a light rear wheel at the peak: a locked rear in a turn takes the car with it', () => {
    // Inside rear unloaded over a kerb on the way into a turn: no extra allowance at the rear.
    expect(lockExcess([-0.05, -0.05, -0.05, -0.15], [5000, 2000, 6700, 50], peak)).toBeCloseTo(
      0.05,
      9,
    );
  });

  it('shapes the lock threshold to the combined slip: a turning tyre has less to give the brake', () => {
    const load = [5000, 1250, 4000, 4000];
    const straight = [0, 0, 0, 0];
    const turning = [0.6, 0.6, 0.6, 0.6].map((u) => u * 0.09); // tan α at 60 % of the peak
    // Straight, the light inside front may slip to 0.2 (sqrt(4) × peak); turning hard it may
    // not: the threshold falls to the friction ellipse's longitudinal room, √(1 − 0.6²) = 0.8.
    expect(lockExcess([-0.05, -0.18, -0.05, -0.05], load, peak, straight, 0.09)).toBeLessThan(0);
    expect(lockExcess([-0.05, -0.18, -0.05, -0.05], load, peak, turning, 0.09)).toBeCloseTo(0.1, 9);
    expect(lockExcess([-0.05, -0.05, -0.05, -0.09], load, peak, turning, 0.09)).toBeCloseTo(
      0.01,
      9,
    );
  });

  it('counts sideways slip against the throttle at the rear', () => {
    const angle = [0, 0, Math.atan(0.09 * 0.8), Math.atan(0.09 * 0.8)];
    // Slip ratio at 70 % of the peak alone is fine; with 80 % of the peak slip angle it is over.
    expect(spinExcess([0, 0, 0.07, 0.07], [0, 0, 0, 0], peak, 0.09)).toBeLessThan(0);
    expect(spinExcess([0, 0, 0.07, 0.07], angle, peak, 0.09)).toBeGreaterThan(0);
    // Braking slip at the rear is not wheelspin.
    expect(spinExcess([0, 0, -0.3, -0.3], angle, peak, 0.09)).toBe(-Infinity);
  });
});
