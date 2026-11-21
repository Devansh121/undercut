import { describe, expect, it } from 'vitest';
import {
  CAR_HALF_WIDTH,
  REFERENCE_CAR,
  addCar,
  carFootprint,
  carOverlap,
  computeMass,
  createCarContacts,
  createWorld,
  resolveCarContacts,
  restoreCar,
  snapshotCar,
  stepWorld,
  type CarState,
  type MassState,
  type World,
  type WorldCar,
} from '../src/index';

const STEP = 1 / 240;

const scratch = (): MassState => ({
  total: 0,
  sprung: 0,
  a: 0,
  b: 0,
  sprungA: 0,
  sprungB: 0,
  yawInertia: 0,
});

/** Planar kinetic energy of a car: translation plus yaw, J. */
function planarEnergy(s: CarState): number {
  const m = computeMass(s.model, s.fuelMass, scratch());
  return 0.5 * m.total * (s.vx * s.vx + s.vy * s.vy) + 0.5 * m.yawInertia * s.yawRate * s.yawRate;
}

/** World velocity of a car's CoG. */
function worldVelocity(s: CarState): { x: number; z: number } {
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  return { x: s.vx * c - s.vy * sn, z: -s.vx * sn - s.vy * c };
}

function momentum(cars: readonly WorldCar[]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const car of cars) {
    const m = computeMass(car.state.model, car.state.fuelMass, scratch()).total;
    const v = worldVelocity(car.state);
    x += m * v.x;
    z += m * v.z;
  }
  return { x, z };
}

function deepestOverlap(world: World): number {
  let worst = 0;
  const cars = world.cars;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      worst = Math.max(worst, carOverlap(cars[i]!.state, cars[j]!.state));
    }
  }
  return worst;
}

describe('car footprint', () => {
  it('is a box from the nose to the tail and the full width, about the CoG', () => {
    const world = createWorld({ step: STEP, seed: 1 });
    const car = addCar(world, REFERENCE_CAR, { x: 10, z: -4, yaw: 0, fuel: 10 });
    const f = carFootprint(car.state);
    // About 5.6 m long and 2 m wide for the 3.6 m wheelbase car.
    expect(f.halfLength * 2).toBeGreaterThan(5.4);
    expect(f.halfLength * 2).toBeLessThan(5.8);
    expect(f.halfWidth).toBe(CAR_HALF_WIDTH);
    // Facing +X: the box centre lies along +X of the CoG (the nose reaches further).
    expect(f.cx).toBeGreaterThan(10 - 1);
    expect(f.cz).toBeCloseTo(-4, 9);
  });

  it('reports no overlap for cars apart and the depth for cars that overlap', () => {
    const world = createWorld({ step: STEP, seed: 1 });
    const a = addCar(world, REFERENCE_CAR, { x: 0, z: 0 });
    const b = addCar(world, REFERENCE_CAR, { x: 0, z: 2.5 });
    expect(carOverlap(a.state, b.state)).toBe(0);
    b.state.z = 1.7;
    expect(carOverlap(a.state, b.state)).toBeCloseTo(0.3, 6);
  });
});

describe('car-to-car contact', () => {
  it('stops a car running into the back of a stopped one: no pass-through, no energy gained', () => {
    const world = createWorld({ step: STEP, seed: 1 });
    const a = addCar(world, REFERENCE_CAR, { x: 0, speed: 30, fuel: 10 });
    const b = addCar(world, REFERENCE_CAR, { x: 8, speed: 0, fuel: 10 });
    const p0 = momentum(world.cars);
    let maxImpulse = 0;
    for (let i = 0; i < 240; i++) {
      stepWorld(world);
      expect(deepestOverlap(world)).toBeLessThan(0.03);
      maxImpulse = Math.max(maxImpulse, a.state.carContactImpulse, b.state.carContactImpulse);
    }
    expect(a.state.x).toBeLessThan(b.state.x);
    expect(b.state.vx).toBeGreaterThan(5);
    expect(maxImpulse).toBeGreaterThan(1000);
    // Momentum moves forward to the hit car; the tyres take some of it, never add.
    const p1 = momentum(world.cars);
    expect(p1.x).toBeLessThanOrEqual(p0.x + 1e-6);
  });

  it('never gains planar kinetic energy in a contact, at any angle', () => {
    for (let k = 0; k < 24; k++) {
      const world = createWorld({ step: STEP, seed: 1 });
      const yaw = (k / 24) * 2 * Math.PI;
      const a = addCar(world, REFERENCE_CAR, { x: 0, z: 0, fuel: 10 });
      const b = addCar(world, REFERENCE_CAR, {
        x: 2.2 * Math.cos(yaw * 0.7),
        z: 1.2 * Math.sin(yaw),
        yaw,
        fuel: 10,
      });
      a.state.vx = 40;
      a.state.vy = 3;
      a.state.yawRate = 0.4;
      b.state.vx = 10 + k;
      b.state.vy = -2;
      b.state.yawRate = -0.3;
      if (carOverlap(a.state, b.state) === 0) continue;
      const before = planarEnergy(a.state) + planarEnergy(b.state);
      const pBefore = momentum(world.cars);
      resolveCarContacts(world.cars, createCarContacts());
      const after = planarEnergy(a.state) + planarEnergy(b.state);
      expect(after).toBeLessThanOrEqual(before * (1 + 1e-12));
      // Impulses come in equal and opposite pairs.
      const pAfter = momentum(world.cars);
      expect(pAfter.x).toBeCloseTo(pBefore.x, 6);
      expect(pAfter.z).toBeCloseTo(pBefore.z, 6);
      expect(carOverlap(a.state, b.state)).toBeLessThan(0.02);
    }
  });

  it('does not tunnel at 100 m/s closing speed, head on or into the side', () => {
    for (const side of [false, true]) {
      for (let offset = -1.5; offset <= 1.5; offset += 0.5) {
        const world = createWorld({ step: STEP, seed: 1 });
        const a = side
          ? addCar(world, REFERENCE_CAR, { x: offset, z: -6, yaw: -Math.PI / 2, fuel: 10 })
          : addCar(world, REFERENCE_CAR, { x: -8, z: offset, fuel: 10 });
        const b = addCar(world, REFERENCE_CAR, { x: 0, z: 0, fuel: 10 });
        a.state.vx = 100;
        const startSide = side
          ? Math.sign(a.state.z - b.state.z)
          : Math.sign(a.state.x - b.state.x);
        for (let i = 0; i < 60; i++) {
          stepWorld(world);
          expect(deepestOverlap(world)).toBeLessThan(0.03);
        }
        const endSide = side ? Math.sign(a.state.z - b.state.z) : Math.sign(a.state.x - b.state.x);
        expect(endSide).toBe(startSide);
      }
    }
  });

  it('turns a car tapped on a rear corner', () => {
    const world = createWorld({ step: STEP, seed: 1 });
    // b ahead and offset to the right of a's path, so a's nose meets b's rear left corner.
    addCar(world, REFERENCE_CAR, { x: 0, z: 0, speed: 25, fuel: 10 });
    const b = addCar(world, REFERENCE_CAR, { x: 7, z: 1.6, speed: 10, fuel: 10 });
    let maxYawRate = 0;
    for (let i = 0; i < 120; i++) {
      stepWorld(world);
      maxYawRate = Math.max(maxYawRate, Math.abs(b.state.yawRate));
    }
    expect(maxYawRate).toBeGreaterThan(0.2);
  });

  it('settles a stack of three cars pushed together', () => {
    const world = createWorld({ step: STEP, seed: 1 });
    const cars = [0, 1, 2].map((k) => addCar(world, REFERENCE_CAR, { x: k * 5.4, fuel: 10 }));
    // The rear car pushes on in first gear; the front two stand on the brakes.
    cars[0]!.input.throttle = 0.4;
    cars[1]!.input.brake = 1;
    cars[2]!.input.brake = 1;
    let worst = 0;
    for (let i = 0; i < 240 * 4; i++) {
      stepWorld(world);
      worst = Math.max(worst, deepestOverlap(world));
      for (const c of cars) {
        expect(Number.isFinite(c.state.x) && Number.isFinite(c.state.yawRate)).toBe(true);
        expect(Math.abs(c.state.pitch)).toBeLessThan(0.1);
        expect(Math.abs(c.state.roll)).toBeLessThan(0.1);
      }
    }
    expect(worst).toBeLessThan(0.03);
    // Settled: no car spinning or jittering at the end.
    for (const c of cars) {
      expect(Math.abs(c.state.yawRate)).toBeLessThan(0.05);
      expect(Math.abs(c.state.vy)).toBeLessThan(0.2);
    }
    expect(cars[0]!.state.x).toBeLessThan(cars[1]!.state.x);
    expect(cars[1]!.state.x).toBeLessThan(cars[2]!.state.x);
  });

  it('is deterministic and restores bit for bit mid-contact', () => {
    const build = (): World => {
      const w = createWorld({ step: STEP, seed: 3 });
      addCar(w, REFERENCE_CAR, { x: 0, z: 0.4, speed: 40, fuel: 10 });
      addCar(w, REFERENCE_CAR, { x: 7, z: 0, speed: 20, fuel: 10 });
      addCar(w, REFERENCE_CAR, { x: 12, z: -1.5, speed: 15, fuel: 10 });
      return w;
    };
    const a = build();
    for (let i = 0; i < 60; i++) stepWorld(a);
    const snaps = a.cars.map((c) => snapshotCar(c.state));
    const b = build();
    b.tick = a.tick;
    b.time = a.time;
    b.cars.forEach((c, i) => restoreCar(c.state, snaps[i]!));
    for (let i = 0; i < 240; i++) {
      stepWorld(a);
      stepWorld(b);
    }
    for (let i = 0; i < 3; i++) {
      expect(Array.from(snapshotCar(b.cars[i]!.state))).toEqual(
        Array.from(snapshotCar(a.cars[i]!.state)),
      );
    }
  });

  it('can be switched off for a world of ghosts', () => {
    const world = createWorld({ step: STEP, seed: 1, carContact: false });
    addCar(world, REFERENCE_CAR, { x: 0, speed: 30 });
    const b = addCar(world, REFERENCE_CAR, { x: 3, speed: 0 });
    for (let i = 0; i < 24; i++) stepWorld(world);
    expect(b.state.carContactImpulse).toBe(0);
    expect(deepestOverlap(world)).toBeGreaterThan(0.5);
  });

  it('allocates nothing per step once warm', () => {
    const world = createWorld({ step: STEP, seed: 1 });
    for (let k = 0; k < 20; k++)
      addCar(world, REFERENCE_CAR, { x: (k % 2) * 3, z: k * 4, speed: 20 });
    for (let i = 0; i < 10; i++) stepWorld(world);
    // Structural check: the contact scratch keeps its arrays across steps.
    const contacts = world.contacts;
    const order = contacts.order;
    for (let i = 0; i < 10; i++) stepWorld(world);
    expect(world.contacts.order).toBe(order);
  });
});
