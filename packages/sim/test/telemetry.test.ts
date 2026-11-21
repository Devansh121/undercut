import { describe, expect, it } from 'vitest';
import {
  REFERENCE_CAR,
  createCarPose,
  createCarState,
  createCarTelemetry,
  interpolateCarPose,
  readCarPose,
  readCarTelemetry,
} from '../src/index';

describe('telemetry view', () => {
  it('reports a car at rest: 1 g vertical once stepped, gear 1, idle, static loads', () => {
    const car = createCarState(REFERENCE_CAR, { fuel: 50 });
    const t = readCarTelemetry(car, createCarTelemetry());
    expect(t.speed).toBe(0);
    expect(t.gear).toBe(1);
    expect(t.engineRpm).toBeCloseTo(4000, 6);
    expect(Array.from(t.wheelLoad).reduce((a, b) => a + b, 0)).toBeCloseTo(850 * 9.80665, 6);
    expect(t.ersStore).toBe(4e6);
    expect(t.fuelMass).toBe(50);
  });
});

describe('pose interpolation', () => {
  it('returns the end poses at alpha 0 and 1 and blends between', () => {
    const a = readCarPose(createCarState(REFERENCE_CAR, { x: 0, yaw: 0.1 }), createCarPose());
    const b = readCarPose(createCarState(REFERENCE_CAR, { x: 2, yaw: 0.3 }), createCarPose());
    const out = createCarPose();
    expect(interpolateCarPose(a, b, 0, out).x).toBe(0);
    expect(interpolateCarPose(a, b, 1, out).x).toBe(2);
    interpolateCarPose(a, b, 0.25, out);
    expect(out.x).toBeCloseTo(0.5, 12);
    expect(out.yaw).toBeCloseTo(0.15, 12);
  });

  it('takes the short way round across ±π', () => {
    const a = createCarPose();
    const b = createCarPose();
    a.yaw = Math.PI - 0.1;
    b.yaw = -Math.PI + 0.1;
    const mid = interpolateCarPose(a, b, 0.5, createCarPose()).yaw;
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-12);
  });
});
