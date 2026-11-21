import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld } from '../src/index';

// The physics validation suite. Every later check (braking distance, top speed,
// lateral g, lap time against a reference) depends on the sim clock being exact,
// so that is the first entry. Tolerances live next to each check with their source.
describe('validation: simulation time base', () => {
  it('keeps sim time exact over a one-hour session at 1 kHz', () => {
    const step = 1 / 1000;
    const world = createWorld({ step, seed: 1 });
    const ticks = 3600 * 1000;
    for (let i = 0; i < ticks; i++) stepWorld(world);
    // Summing 0.001 3.6 million times would drift by tens of microseconds; time
    // is derived from the integer tick so the error stays at rounding level.
    expect(Math.abs(world.time - 3600)).toBeLessThan(1e-9);
  });
});
