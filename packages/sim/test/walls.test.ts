import { describe, expect, it } from 'vitest';
import {
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  REFERENCE_CAR,
  bodyCorners,
  checkCarInvariants,
  createCarState,
  createCarTelemetry,
  createEnvironment,
  invariantLimits,
  readCarTelemetry,
  stepCar,
  type CarState,
  type ControlInput,
  type SurfaceSampler,
} from '../src/index';

const env = createEnvironment();
const STEP = 1 / 240;

/** Flat asphalt with a straight barrier along z = WALL: everything at z > WALL is behind it. */
const WALL = 10;
const walled: SurfaceSampler = {
  sample: FLAT_SURFACE.sample,
  wall(_x, z, _hint, out) {
    out.depth = z - WALL;
    out.normalX = 0;
    out.normalZ = -1;
  },
};

/** The deepest any body corner reaches past the wall, m. */
function deepest(car: CarState): number {
  let worst = -Infinity;
  const corners = bodyCorners(car, new Float64Array(8));
  for (let k = 0; k < 4; k++) worst = Math.max(worst, corners[2 * k + 1]! - WALL);
  return worst;
}

/**
 * A car heading into the wall: `angle` between its heading and the wall, rad, at `speed` m/s,
 * starting 6 m short of it. Heading +X is along the wall; −yaw turns toward +Z (right).
 */
function hit(angle: number, speed: number, input: Partial<ControlInput> = {}) {
  const car = createCarState(REFERENCE_CAR, { x: 0, z: WALL - 6, yaw: -angle, speed });
  const inp = { ...NEUTRAL_INPUT, ...input };
  const tel = createCarTelemetry();
  const limits = invariantLimits(car.model);
  let impact = 0;
  let first = 0;
  let worst = -Infinity;
  let broken: string | null = null;
  for (let t = 0; t < 240 * 4; t++) {
    stepCar(car, inp, walled, STEP, env);
    readCarTelemetry(car, tel);
    impact = Math.max(impact, tel.wallImpact);
    if (first === 0) first = tel.wallImpact;
    worst = Math.max(worst, deepest(car));
    broken ??= checkCarInvariants(car, limits);
  }
  return { car, impact, first, worst, broken };
}

describe('barrier contact', () => {
  it('a sampler without walls leaves the car alone', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 30 });
    for (let t = 0; t < 240; t++) stepCar(car, NEUTRAL_INPUT, FLAT_SURFACE, STEP, env);
    expect(car.wallImpactSpeed).toBe(0);
    expect(car.wallContact).toBe(0);
  });

  it('stops a car before the barrier line whatever the angle and speed', () => {
    for (const deg of [5, 20, 45, 70, 90]) {
      for (const speed of [15, 50, 85]) {
        const r = hit((deg * Math.PI) / 180, speed);
        // Contact is resolved every substep: a corner is never more than one substep's travel
        // past the line, and it is pushed straight back.
        expect(r.worst, `${deg}° at ${speed} m/s`).toBeLessThan(speed / 960 + 1e-6);
        expect(r.car.z, `${deg}° at ${speed} m/s`).toBeLessThan(WALL);
        expect(r.broken, `${deg}° at ${speed} m/s`).toBeNull();
      }
    }
  });

  it('reports the impact as the speed normal to the wall', () => {
    const angle = (30 * Math.PI) / 180;
    const r = hit(angle, 60);
    // The first corner to touch carries the car's normal speed plus a little from its yaw rate.
    expect(r.first).toBeGreaterThan(60 * Math.sin(angle) * 0.9);
    expect(r.first).toBeLessThan(60 * Math.sin(angle) * 1.2);
    // The tail then swings into the wall too; no contact is ever faster than the car.
    expect(r.impact).toBeGreaterThanOrEqual(r.first);
    expect(r.impact).toBeLessThan(60);
  });

  it('turns a glancing hit into a slide along the wall, scrubbing speed, without bouncing off', () => {
    const angle = (20 * Math.PI) / 180;
    const r = hit(angle, 60);
    const c = Math.cos(r.car.yaw);
    const sn = Math.sin(r.car.yaw);
    const along = r.car.vx * c - r.car.vy * sn;
    const away = -(-r.car.vx * sn - r.car.vy * c);
    // Still moving along the wall, slower than the 56 m/s it arrived with along it.
    expect(along).toBeGreaterThan(10);
    expect(along).toBeLessThan(60 * Math.cos(angle));
    // Not flung back across the track: at most a gentle drift away from the wall.
    expect(away).toBeLessThan(4);
    // Turned toward the wall's direction rather than stuck nose-in.
    expect(Math.abs(r.car.yaw)).toBeLessThan(angle);
  });

  it('a head-on hit stops the car at the wall', () => {
    const r = hit(Math.PI / 2, 40, { brake: 1 });
    expect(Math.hypot(r.car.vx, r.car.vy)).toBeLessThan(3);
    expect(r.car.z).toBeLessThan(WALL);
  });
});
