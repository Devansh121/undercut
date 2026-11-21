import { describe, expect, it } from 'vitest';
import {
  brakeWhileTurning,
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
    for (const latG of [1.5, 2.4, 3.0]) {
      const r = liftOffInCorner({ latG });
      expect(r.spun).toBe(false);
      expect(r.yawRateRise).toBeLessThan(0.4);
    }
  });

  it('full throttle out of a slow corner spins without TC and stays stable with it', () => {
    expect(throttleOutOfSlowCorner({ tractionControl: 0 }).spun).toBe(true);
    for (const level of [1, 2, 3]) {
      const r = throttleOutOfSlowCorner({ tractionControl: level });
      expect(r.spun, `TC ${level}`).toBe(false);
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
      expect(r.maxSideslipDeg, `ABS ${level}`).toBeLessThan(12);
    }
  });
});
