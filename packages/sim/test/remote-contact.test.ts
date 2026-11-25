import { describe, expect, it } from 'vitest';
import {
  BODY_HALF_WIDTH,
  BODY_NOSE,
  BODY_TAIL,
  FLAT_SURFACE,
  MAX_CONTACT_EXTRAPOLATION_S,
  MAX_REMOTE_PUSH_PER_STEP,
  REFERENCE_CAR,
  addCar,
  bodyCorners,
  carOverlap,
  computeMass,
  createWorld,
  extrapolateRemoteBody,
  resolveRemoteCarContacts,
  stepCar,
  type CarState,
  type RemoteContactBody,
  type SurfaceSampler,
} from '../src/index';

const STEP = 1 / 240;

function makeRemoteFromCar(seat: number, s: CarState, ghost = false): RemoteContactBody {
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  return {
    seat,
    x: s.x,
    z: s.z,
    yaw: s.yaw,
    vx: s.vx * c - s.vy * sn,
    vz: -s.vx * sn - s.vy * c,
    yawRate: s.yawRate,
    ghost,
  };
}

/** Flat surface with a rigid straight barrier at z <= zMin (inward normal +Z). */
function surfaceWithWallAtZ(zMin: number): SurfaceSampler {
  return {
    sample: FLAT_SURFACE.sample,
    wall(_x, z, _hint, out) {
      out.thin = false;
      if (z < zMin) {
        out.depth = zMin - z;
        out.normalX = 0;
        out.normalZ = 1;
      } else {
        out.depth = 0;
        out.normalX = 0;
        out.normalZ = 1;
      }
      return out;
    },
  };
}

describe('extrapolateRemoteBody', () => {
  it('advances straight along world velocity and clamps at MAX_CONTACT_EXTRAPOLATION_S', () => {
    const src: RemoteContactBody = { seat: 1, x: 10, z: -5, yaw: 0, vx: 60, vz: 0, yawRate: 0 };
    const out: RemoteContactBody = { ...src };
    extrapolateRemoteBody(src, 0.1, out);
    expect(out.x).toBeCloseTo(16, 6);
    expect(out.z).toBeCloseTo(-5, 6);
    expect(out.yaw).toBeCloseTo(0, 6);

    extrapolateRemoteBody(src, 1.0, out);
    expect(out.x).toBeCloseTo(10 + 60 * MAX_CONTACT_EXTRAPOLATION_S, 6);
  });

  it('curves along a constant yaw-rate arc instead of a straight tangent', () => {
    const r = 100;
    const speed = 50;
    const yawRate = speed / r; // 0.5 rad/s turning left (-Z in sim coords)
    const src: RemoteContactBody = { seat: 1, x: 0, z: 0, yaw: 0, vx: speed, vz: 0, yawRate };
    const out: RemoteContactBody = { ...src };
    const dt = 0.2;
    extrapolateRemoteBody(src, dt, out);
    // Exact circle: x = r*sin(w*dt), z = -r*(1 - cos(w*dt))
    const exactX = r * Math.sin(yawRate * dt);
    const exactZ = -r * (1 - Math.cos(yawRate * dt));
    expect(Math.abs(out.x - exactX)).toBeLessThan(0.02);
    expect(Math.abs(out.z - exactZ)).toBeLessThan(0.02);
    expect(Math.hypot(out.vx, out.vz)).toBeCloseTo(speed, 6);
  });
});

describe('resolveRemoteCarContacts', () => {
  it('separates two cars side-by-side symmetrically with plausible lateral impulses', () => {
    const worldA = createWorld({ step: STEP, seed: 1 });
    const worldB = createWorld({ step: STEP, seed: 2 });
    const carA = addCar(worldA, REFERENCE_CAR, { x: 0, z: -0.95, yaw: 0, speed: 60, fuel: 20 });
    const carB = addCar(worldB, REFERENCE_CAR, { x: 0, z: 0.95, yaw: 0, speed: 60, fuel: 20 });
    // Converging laterally at 2 m/s each (vy is left = -Z; so carA moves +Z with vy=-2, carB moves -Z with vy=+2).
    carA.state.vy = -2;
    carB.state.vy = 2;

    expect(carOverlap(carA.state, carB.state)).toBeGreaterThan(0.05);

    const proxyB = makeRemoteFromCar(1, carB.state);
    const proxyA = makeRemoteFromCar(0, carA.state);

    const touchedA = resolveRemoteCarContacts(carA.state, [proxyB], FLAT_SURFACE);
    const touchedB = resolveRemoteCarContacts(carB.state, [proxyA], FLAT_SURFACE);

    expect(touchedA).toBe(1);
    expect(touchedB).toBe(1);
    // Both pushed apart symmetrically (A toward -Z, B toward +Z).
    expect(carA.state.z).toBeLessThan(-0.95);
    expect(carB.state.z).toBeGreaterThan(0.95);
    expect(carA.state.z + carB.state.z).toBeCloseTo(0, 6);
    // Both lateral velocities reversed/damped outward (A now vy > 0, B now vy < 0).
    expect(carA.state.vy).toBeGreaterThan(0);
    expect(carB.state.vy).toBeLessThan(0);
    expect(carA.state.vy + carB.state.vy).toBeCloseTo(0, 6);
    expect(carA.state.carContactImpulse).toBeGreaterThan(0);
    expect(carB.state.carContactImpulse).toBeCloseTo(carA.state.carContactImpulse, 3);
  });

  it('never pushes a car through a barrier when pinned against a wall, and never launches vertically', () => {
    const wallZ = -3.0;
    const surface = surfaceWithWallAtZ(wallZ);
    const world = createWorld({ step: STEP, seed: 1, surface });
    // Local car right alongside the barrier at z = -3 + BODY_HALF_WIDTH = -2.0.
    const car = addCar(world, REFERENCE_CAR, {
      x: 0,
      z: wallZ + BODY_HALF_WIDTH + 0.02,
      yaw: 0,
      speed: 55,
      fuel: 20,
    });
    const initialY = car.state.y;
    const initialHeave = car.state.heaveRate;

    // Aggressive remote car overlapping heavily from the +Z side pushing toward the wall (-Z).
    const remote: RemoteContactBody = {
      seat: 1,
      x: 0,
      z: wallZ + BODY_HALF_WIDTH + 1.2, // 0.8 m deep overlap!
      yaw: 0,
      vx: 55,
      vz: -15,
      yawRate: 0,
    };

    const corners = new Float64Array(8);
    for (let step = 0; step < 30; step++) {
      stepCar(car.state, car.input, surface, STEP, world.environment);
      resolveRemoteCarContacts(car.state, [remote], surface);
      remote.x += remote.vx * STEP;
      bodyCorners(car.state, corners);
      for (let k = 0; k < 4; k++) {
        expect(corners[2 * k + 1]!).toBeGreaterThanOrEqual(wallZ - 1e-6);
      }
      // Strictly planar contact: car stays firmly grounded, never launched.
      expect(Math.abs(car.state.y - initialY)).toBeLessThan(0.15);
      expect(Math.abs(car.state.heaveRate - initialHeave)).toBeLessThan(2);
      expect(Number.isFinite(car.state.x)).toBe(true);
      expect(Number.isFinite(car.state.vx)).toBe(true);
    }
  });

  it('bounds positional push-out and impulse under deep latency-induced overlap', () => {
    const world = createWorld({ step: STEP, seed: 3 });
    const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw: 0, speed: 60, fuel: 20 });
    const z0 = car.state.z;
    const remote: RemoteContactBody = {
      seat: 1,
      x: 0,
      z: 0.8, // 1.2 m overlap, extreme closing velocity 90 m/s
      yaw: 0,
      vx: 60,
      vz: -90,
      yawRate: 0,
    };
    const touched = resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE);
    expect(touched).toBe(1);
    // Positional change is strictly bounded by REMOTE_CONTACT_PASSES * MAX_REMOTE_PUSH_PER_STEP.
    expect(Math.abs(car.state.z - z0)).toBeLessThanOrEqual(2 * MAX_REMOTE_PUSH_PER_STEP + 1e-9);
    // Closing speed was capped so lateral delta-v stays sane (not 50+ m/s launch).
    expect(Math.abs(car.state.vy)).toBeLessThan(26);
    expect(car.state.heaveRate).toBe(0);
  });

  it('ignores ghosted remote cars', () => {
    const world = createWorld({ step: STEP, seed: 4 });
    const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw: 0, speed: 50, fuel: 20 });
    const z0 = car.state.z;
    const remote: RemoteContactBody = {
      seat: 1,
      x: 0,
      z: 0.5,
      yaw: 0,
      vx: 50,
      vz: -5,
      yawRate: 0,
      ghost: true,
    };
    expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(0);
    expect(car.state.z).toBe(z0);
    expect(car.state.carContacts).toBe(0);
  });
});

describe('aged remote poses', () => {
  it.each([0, Math.PI / 3])(
    'does not contact stale parallel or separating cars at yaw %s',
    (yaw) => {
      for (const lateralSpeed of [0, 2]) {
        const world = createWorld({ step: STEP, seed: 1 });
        const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw, speed: 20 });
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        const remote: RemoteContactBody = {
          seat: 1,
          x: 2.15 * sn,
          z: 2.15 * c,
          yaw,
          vx: 25 * c + lateralSpeed * sn,
          vz: -25 * sn + lateralSpeed * c,
          yawRate: 0,
          ageSec: 0.2,
        };
        const before = { ...car.state };
        expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(0);
        expect(car.state).toEqual(before);
      }
    },
  );

  it('does not contact a stale car just ahead that is pulling away or matching speed', () => {
    for (const remoteSpeed of [20, 30]) {
      const world = createWorld({ step: STEP, seed: 1 });
      const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw: 0, speed: 20 });
      // Nose-to-tail with a 0.1 m gap: inside the former 0.3 m isotropic allowance.
      const m = computeMass(car.state.model, car.state.fuelMass, {
        total: 0,
        sprung: 0,
        a: 0,
        b: 0,
        sprungA: 0,
        sprungB: 0,
        yawInertia: 0,
      });
      const remote: RemoteContactBody = {
        seat: 1,
        x: m.a + BODY_NOSE + m.b + BODY_TAIL + 0.1,
        z: 0,
        yaw: 0,
        vx: remoteSpeed,
        vz: 0,
        yawRate: 0,
        ageSec: 0.2,
      };
      const before = { ...car.state };
      expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(0);
      expect(car.state).toEqual(before);
    }
  });

  it('bounds prediction by normal closing speed regardless of tangential speed', () => {
    const world = createWorld({ step: STEP, seed: 1 });
    const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw: 0, speed: 20 });
    const remote: RemoteContactBody = {
      seat: 1,
      x: 0,
      z: 2.15,
      yaw: 0,
      vx: 40,
      vz: -0.1,
      yawRate: 0,
      ageSec: 0.2,
    };
    const before = { ...car.state };
    expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(0);
    expect(car.state).toEqual(before);
  });

  it('anticipates converging stale poses without adding vertical motion or unbounded separation', () => {
    const world = createWorld({ step: STEP, seed: 1 });
    const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw: 0, speed: 20 });
    car.state.vy = -1;
    const remote: RemoteContactBody = {
      seat: 1,
      x: 0,
      z: 2.15,
      yaw: 0,
      vx: 20,
      vz: -1,
      yawRate: 0,
      ageSec: 0.2,
    };
    const y = car.state.y;
    expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(1);
    expect(car.state.z).toBeLessThan(0);
    expect(-car.state.z).toBeLessThanOrEqual(MAX_REMOTE_PUSH_PER_STEP);
    expect(car.state.carContactImpulse).toBeGreaterThan(0);
    expect(car.state.y).toBe(y);
  });

  it.each([-0.04, -0.01, 0.01, 0.04])(
    'anticipates converging stale poses at a small relative yaw of %s rad',
    (yaw) => {
      const world = createWorld({ step: STEP, seed: 1 });
      const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw: 0, speed: 20 });
      // Alongside with a small gap and a steering difference, closing laterally at 1 m/s.
      const remote: RemoteContactBody = {
        seat: 1,
        x: 0,
        z: 2 * BODY_HALF_WIDTH + 0.1,
        yaw,
        vx: 20 * Math.cos(yaw),
        vz: -20 * Math.sin(yaw) - 1,
        yawRate: 0,
        ageSec: 0.2,
      };
      const y = car.state.y;
      expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(1);
      expect(car.state.carContactImpulse).toBeGreaterThan(0);
      expect(car.state.y).toBe(y);
    },
  );

  it('reserves the hidden approach of a stale overlapping pose only while closing', () => {
    const run = (ageSec: number, vz: number) => {
      const world = createWorld({ step: STEP, seed: 1 });
      const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw: 0, speed: 20 });
      // Overlapping by 0.04 m: just past the contact slop.
      const remote: RemoteContactBody = {
        seat: 1,
        x: 0,
        z: 2 * BODY_HALF_WIDTH - 0.04,
        yaw: 0,
        vx: 20,
        vz,
        yawRate: 0,
        ageSec,
      };
      const y = car.state.y;
      expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(1);
      expect(car.state.y).toBe(y);
      return -car.state.z;
    };
    // Closing at 1 m/s: a 0.2 s old pose hides 0.2 m of approach along the normal.
    const fresh = run(0, -1);
    const stale = run(0.2, -1);
    expect(stale).toBeGreaterThan(fresh);
    expect(stale).toBeLessThanOrEqual(MAX_REMOTE_PUSH_PER_STEP);
    // Separating or parallel: age adds nothing to the overlap.
    for (const vz of [0, 1]) expect(run(0.2, vz)).toBe(run(0, vz));
  });

  it('caps the prediction allowance even for extremely old converging poses', () => {
    const world = createWorld({ step: STEP, seed: 1 });
    const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw: 0, speed: 20 });
    car.state.vy = -1;
    const remote: RemoteContactBody = {
      seat: 1,
      x: 0,
      z: 2.35,
      yaw: 0,
      vx: 20,
      vz: -1,
      yawRate: 0,
      ageSec: 100,
    };
    expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(0);
    remote.ageSec = 0;
    remote.z = 2.15;
    expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(0);
  });

  it('does not expand fresh or equally moving remote poses', () => {
    for (const ageSec of [0, 0.2]) {
      const world = createWorld({ step: STEP, seed: 1 });
      const car = addCar(world, REFERENCE_CAR, { x: 0, z: 0, yaw: 0, speed: 20 });
      const remote: RemoteContactBody = {
        seat: 1,
        x: 0,
        z: 2.15,
        yaw: 0,
        vx: 20,
        vz: 0,
        yawRate: 0,
        ageSec,
      };
      expect(resolveRemoteCarContacts(car.state, [remote], FLAT_SURFACE)).toBe(0);
    }
  });
});
