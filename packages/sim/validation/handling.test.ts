import { describe, expect, it } from 'vitest';
import {
  brakeWhileTurning,
  absStraightStop,
  liftOffInCorner,
  stepSteer,
  throttleOutOfSlowCorner,
} from './lib/index';

// Not doc targets: stability checks so the car is predictable at the limit for keyboard and
// phone drivers using assists (brief: no "on ice" or "on rails" behaviour).
describe('handling: stability at and near the limit', () => {
  for (const speed of [80, 150, 250]) {
    it(`a step steer at ${speed} km/h settles without large overshoot`, () => {
      const r = stepSteer({ speed: speed / 3.6, steer: speed > 200 ? 0.06 : 0.12 });
      expect(r.steadyYawRate).toBeGreaterThan(0);
      expect(r.overshoot).toBeLessThan(0.3);
      expect(r.riseTime).toBeLessThan(0.3);
      expect(r.maxSideslipDeg).toBeLessThan(5);
    });
  }

  it('lifting off mid-corner tightens the line but does not spin the car', () => {
    for (const [kmh, fraction] of [
      [150, 0.6],
      [150, 0.8],
      [150, 0.95],
      [250, 0.9],
    ] as const) {
      const r = liftOffInCorner({ speed: kmh / 3.6, fraction });
      // The corner really was held at that share of the limit before the lift.
      expect(r.achievedLatG / r.latG, `${kmh} km/h at ${fraction}`).toBeGreaterThan(0.97);
      expect(r.spun, `${kmh} km/h at ${fraction}`).toBe(false);
      expect(r.yawRateRise, `${kmh} km/h at ${fraction}`).toBeLessThan(0.4);
    }
  });

  it('full throttle out of a slow corner lights up the rears without TC, not with it', () => {
    const off = throttleOutOfSlowCorner({ tractionControl: 0 });
    // Past the friction peak (10 % slip) by half again, and more than any TC level allows.
    expect(off.maxRearSlip).toBeGreaterThan(0.15);
    for (const level of [1, 2, 3]) {
      const r = throttleOutOfSlowCorner({ tractionControl: level });
      expect(r.spun, `TC ${level}`).toBe(false);
      expect(r.maxRearSlip, `TC ${level}`).toBeLessThan(0.2);
      expect(r.maxRearSlip, `TC ${level}`).toBeLessThan(off.maxRearSlip);
      expect(r.maxSideslipDeg, `TC ${level}`).toBeLessThan(8);
      expect(r.endSpeedKmh, `TC ${level}`).toBeGreaterThan(85);
    }
  });

  it('full brake while turning locks without ABS and stays stable with it', () => {
    expect(brakeWhileTurning({ abs: 0 }).minSlip).toBeLessThan(-0.5);
    for (const level of [1, 2, 3]) {
      const r = brakeWhileTurning({ abs: level });
      expect(r.spun, `ABS ${level}`).toBe(false);
      expect(r.minSlip, `ABS ${level}`).toBeGreaterThan(-0.25);
      // Level 1 allows the most slip by design, so it lets the car slide a little further.
      expect(r.maxSideslipDeg, `ABS ${level}`).toBeLessThan(level === 1 ? 15 : 10);
    }
  });

  it('ABS stops lock-up from 300 km/h in high-downforce trim and shortens the stop', () => {
    const locked = absStraightStop({ abs: 0 });
    expect(locked.minSlip).toBeLessThan(-0.5);
    for (const level of [1, 2, 3]) {
      const r = absStraightStop({ abs: level });
      expect(r.minSlip, `ABS ${level}`).toBeGreaterThan(-0.3);
      expect(r.spun, `ABS ${level}`).toBe(false);
      expect(r.distance, `ABS ${level}`).toBeLessThan(locked.distance);
    }
  });
});
