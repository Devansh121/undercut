import { describe, expect, it } from 'vitest';
import { REFERENCE_CAR, addCar, createWorld, snapshotCar, stepWorld } from '../src/index';

describe('world', () => {
  it('starts at tick zero with the given step and seed', () => {
    const world = createWorld({ step: 1 / 240, seed: 9 });
    expect(world.tick).toBe(0);
    expect(world.time).toBe(0);
    expect(world.step).toBe(1 / 240);
  });

  it('advances one tick per step and derives time from the tick count', () => {
    const world = createWorld({ step: 1 / 240, seed: 9 });
    for (let i = 0; i < 240; i++) stepWorld(world);
    expect(world.tick).toBe(240);
    expect(world.time).toBe(1);
  });

  it('is reproducible: two worlds with the same seed draw the same numbers', () => {
    const a = createWorld({ step: 0.01, seed: 77 });
    const b = createWorld({ step: 0.01, seed: 77 });
    for (let i = 0; i < 100; i++) {
      stepWorld(a);
      stepWorld(b);
    }
    expect(a.rng.nextUint32()).toBe(b.rng.nextUint32());
  });

  it('owns cars and steps each one with its own input, keeping the previous pose', () => {
    const world = createWorld({ step: 1 / 240, seed: 1 });
    const a = addCar(world, REFERENCE_CAR, { speed: 30, gear: 4 });
    const b = addCar(world, REFERENCE_CAR, { z: 10, speed: 30, gear: 4 });
    expect([a.id, b.id]).toEqual([0, 1]);
    a.input.throttle = 1;
    for (let i = 0; i < 240; i++) stepWorld(world);
    expect(a.state.x).toBeGreaterThan(b.state.x);
    expect(a.pose.x).toBe(a.state.x);
    expect(a.previousPose.x).toBeLessThan(a.pose.x);
    expect(b.state.z).toBeCloseTo(10, 6);
  });

  it('is deterministic: two worlds with the same inputs end bit-identical', () => {
    const make = () => {
      const w = createWorld({ step: 1 / 240, seed: 5 });
      const car = addCar(w, REFERENCE_CAR, { speed: 20, gear: 3 });
      for (let i = 0; i < 480; i++) {
        car.input.throttle = (i % 97) / 96;
        car.input.steer = Math.sin(i / 30) * 0.4;
        stepWorld(w);
      }
      return Array.from(snapshotCar(car.state));
    };
    expect(make()).toEqual(make());
  });
});
