import { expect, it } from 'vitest';
import { StartGate } from '../../src/online/start-gate';

it('holds pre-start ticks and releases the first eligible tick inside a delayed frame', () => {
  const step = 1 / 240;
  const simulate = (frameEnd: number, elapsed: number, remainder: number) => {
    const gate = new StartGate();
    const worldTime = 10;
    gate.beginFrame(frameEnd, elapsed, remainder, worldTime);
    let release: number | null = null;
    const held: number[] = [];
    for (let i = 0; i < Math.floor((elapsed + remainder) / step); i++) {
      const at = gate.tickAt(worldTime + i * step);
      if (at < 1000) held.push(at);
      else if (release === null) release = at;
    }
    expect(held.length).toBeGreaterThan(0);
    expect(release).not.toBeNull();
    expect(release!).toBeGreaterThanOrEqual(1000);
    expect(release!).toBeLessThan(1000 + step * 1000);
    return release!;
  };
  // Render callbacks arrive 180 ms apart. Both simulations still release on their
  // first eligible fixed tick, rather than releasing every catch-up tick together.
  const a = simulate(1008, 0.016, 0.002);
  const b = simulate(1188, 0.2, 0.001);
  expect(Math.abs(a - b)).toBeLessThan(step * 1000);
});

it('preserves the release tick when a stall clamp would discard lights-out', () => {
  const gate = new StartGate();
  // A frame arrives 334 ms after lights-out. Only 250 ms can be simulated.
  gate.beginFrame(1334, 0.25, 0.001, 7.6, 1000);
  expect(gate.tickAt(7.6)).toBe(1000);
  expect(gate.tickAt(7.6 + 1 / 240)).toBeCloseTo(1000 + 1000 / 240, 6);
  // Once released, subsequent frames use the normal catch-up interval.
  gate.beginFrame(1350, 0.016, 0, 7.85);
  expect(gate.tickAt(7.85)).toBe(1334);
});
