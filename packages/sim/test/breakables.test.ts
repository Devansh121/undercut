import { describe, expect, it } from 'vitest';
import {
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  REFERENCE_CAR,
  createCarState,
  createEnvironment,
  stepCar,
  addCar,
  createWorld,
  stepWorld,
  snapshotCar,
  restoreCar,
  BreakableIndex,
  breakableContact,
  createDebrisPose,
  debrisPose,
  settledHit,
} from '../src/index';

const board = { id: 0, x: 8, y: 0, z: 0, yaw: 0, halfWidth: 2.18, halfDepth: 0.34, mass: 12 };
const surface = { sample: FLAT_SURFACE.sample, breakables: new BreakableIndex([board]) };
const env = createEnvironment();

describe('light trackside objects', () => {
  it('breaks a 12 kg board once, losing 0.5–3 percent speed without stopping or pinning', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 30 });
    const control = createCarState(REFERENCE_CAR, { speed: 30 });
    for (let i = 0; i < 80; i++) {
      stepCar(car, NEUTRAL_INPUT, surface, 1 / 240, env);
      stepCar(control, NEUTRAL_INPUT, FLAT_SURFACE, 1 / 240, env);
    }
    expect(car.brokenObjects[0]! & 1).toBe(1);
    expect(car.vx / control.vx).toBeGreaterThan(0.97);
    expect(car.vx / control.vx).toBeLessThan(0.995);
    expect(car.x).toBeGreaterThan(board.x);
    expect(car.wallContact).toBe(0);
    const copy = createCarState(REFERENCE_CAR);
    restoreCar(copy, snapshotCar(car));
    expect(copy.brokenObjects).toEqual(car.brokenObjects);
  });

  it('consumes a board once for the whole field, including an AI car that arrives first', () => {
    const world = createWorld({ step: 1 / 240, seed: 1, surface, carContact: false });
    const ahead = addCar(world, REFERENCE_CAR, { speed: 30 });
    const behind = addCar(world, REFERENCE_CAR, { x: -8, speed: 30 });
    for (let i = 0; i < 160; i++) stepWorld(world);
    expect(ahead.state.breakableHitCount).toBe(1);
    expect(behind.state.breakableHitCount).toBe(0);
    expect(behind.state.brokenObjects).toEqual(ahead.state.brokenObjects);
    expect(behind.state.vx).toBeGreaterThan(ahead.state.vx);
  });

  it('passes over a board with the floor above its top, and breaks it at road height', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 30 });
    car.y = 10;
    breakableContact(car, surface.breakables);
    car.x = board.x;
    breakableContact(car, surface.breakables);
    expect(car.brokenObjects[0]).toBe(0);
    car.y = 0.3;
    breakableContact(car, surface.breakables);
    expect(car.brokenObjects[0]! & 1).toBe(1);
  });

  it('uses the whole body and misses a board beside the car', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 85, z: 4 });
    for (let i = 0; i < 40; i++) stepCar(car, NEUTRAL_INPUT, surface, 1 / 240, env);
    expect(car.brokenObjects[0]).toBe(0);
  });

  it('produces identical spinning, bouncing and settled debris from the same hit', () => {
    const hit = { object: board, time: 2, vx: 25, vz: 3 };
    const pose = (h: typeof hit, t: number) => ({ ...debrisPose(h, t, createDebrisPose()) });
    for (const t of [2, 2.1, 2.5, 3, 5, 10]) {
      expect(pose(hit, t)).toEqual(pose(structuredClone(hit), t));
      expect(pose(hit, t).lift).toBeGreaterThanOrEqual(0);
      expect(pose(hit, t).y).toBeGreaterThanOrEqual(board.y);
    }
    expect(pose(hit, 3).roll).not.toBe(0);
    expect(pose(hit, 20)).toEqual(pose(hit, 21));
    // At rest: face down, on the ground at its depth.
    expect(pose(hit, 20).roll).toBeCloseTo(-Math.PI / 2, 12);
    expect(pose(hit, 20).lift).toBe(0);
    expect(pose(hit, 20).y).toBeCloseTo(board.y + board.halfDepth, 12);
  });

  it("fills the caller's pose object instead of allocating one", () => {
    const out = createDebrisPose();
    const hit = { object: board, time: 0, vx: 10, vz: 0 };
    expect(debrisPose(hit, 0.4, out)).toBe(out);
    // A board known down with no hit to replay lies where it stood.
    const down = debrisPose(settledHit(board), 0, createDebrisPose());
    expect([down.x, down.z, down.lift]).toEqual([board.x, board.z, 0]);
  });
});
