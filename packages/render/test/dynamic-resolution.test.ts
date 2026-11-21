import { describe, expect, it } from 'vitest';
import { DynamicResolution } from '../src/pipeline/dynamic-resolution';

function run(dr: DynamicResolution, ms: (scale: number) => number, seconds: number): number[] {
  const scales: number[] = [];
  let t = 0;
  while (t < seconds) {
    const frame = ms(dr.scale);
    dr.update(frame);
    t += frame / 1000;
    scales.push(dr.scale);
  }
  return scales;
}

describe('DynamicResolution', () => {
  it('stays at full resolution while the target is met', () => {
    const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6 });
    const s = run(dr, () => 12, 5);
    expect(Math.min(...s)).toBe(1);
  });

  it('drops resolution until a GPU-bound frame fits the target, then holds it without hunting', () => {
    const dr = new DynamicResolution({ targetMs: 16.67, min: 0.5 });
    // Cost scales with pixel count: 24 ms at full resolution.
    const s = run(dr, (k) => 24 * k * k, 20);
    const last = s.slice(-200);
    const settled = last[last.length - 1] as number;
    expect(24 * settled * settled).toBeLessThanOrEqual(16.67);
    expect(settled).toBeGreaterThan(0.7);
    // Holds: no change over the last couple of hundred frames.
    expect(new Set(last).size).toBe(1);
  });

  it('never goes below the floor', () => {
    const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6 });
    const s = run(dr, () => 50, 10);
    expect(Math.min(...s)).toBeCloseTo(0.6, 5);
  });

  it('recovers when the load goes away', () => {
    const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6 });
    run(dr, () => 30, 5);
    expect(dr.scale).toBeLessThan(1);
    run(dr, (k) => 8 * k * k, 10);
    expect(dr.scale).toBe(1);
  });

  it('ignores a single stall (tab switch, shader compile)', () => {
    const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6 });
    run(dr, () => 10, 2);
    dr.update(400);
    run(dr, () => 10, 0.2);
    expect(dr.scale).toBe(1);
  });

  it('is off when the target is 0', () => {
    const dr = new DynamicResolution({ targetMs: 0, min: 1 });
    run(dr, () => 80, 3);
    expect(dr.scale).toBe(1);
  });
});
