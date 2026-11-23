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
  debrisPose,
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

  it('uses the whole body and misses a board beside the car', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 85, z: 4 });
    for (let i = 0; i < 40; i++) stepCar(car, NEUTRAL_INPUT, surface, 1 / 240, env);
    expect(car.brokenObjects[0]).toBe(0);
  });

  it('produces identical spinning, bouncing and settled debris from the same hit', () => {
    const hit = { object: board, time: 2, vx: 25, vz: 3 };
    for (const t of [2, 2.1, 2.5, 3, 5, 10]) {
      expect(debrisPose(hit, t)).toEqual(debrisPose(structuredClone(hit), t));
      expect(debrisPose(hit, t).y).toBeGreaterThanOrEqual(board.y + 0.1);
    }
    expect(debrisPose(hit, 3).roll).not.toBe(0);
    expect(debrisPose(hit, 20)).toEqual(debrisPose(hit, 21));
  });
});
