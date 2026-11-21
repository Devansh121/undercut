import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld } from '../src/index';

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
});
