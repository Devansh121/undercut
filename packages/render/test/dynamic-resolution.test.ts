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

  it('treats sustained severe overload as load, not as stalls: 300 frames of 100 ms reach the floor', () => {
    const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6 });
    for (let i = 0; i < 300; i++) dr.update(100);
    expect(dr.scale).toBeCloseTo(0.6, 5);
  });

  it('still ignores a few separate stalls among normal frames', () => {
    const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6 });
    for (let k = 0; k < 5; k++) {
      dr.update(250);
      for (let i = 0; i < 60; i++) dr.update(12);
    }
    expect(dr.scale).toBe(1);
  });

  it('ignores the slow frames of a start or a teleport (warm-up), then works as usual', () => {
    const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6 });
    for (let i = 0; i < 20; i++) dr.update(120);
    for (let i = 0; i < 300; i++) dr.update(8);
    expect(dr.scale).toBe(1);
    dr.rewarm();
    for (let i = 0; i < 20; i++) dr.update(120);
    expect(dr.scale).toBe(1);
  });

  it('is off when the target is 0', () => {
    const dr = new DynamicResolution({ targetMs: 0, min: 1 });
    run(dr, () => 80, 3);
    expect(dr.scale).toBe(1);
  });

  describe('above the preset cap (max > 1)', () => {
    it('climbs to the ceiling on measured headroom (GPU time), and stays there', () => {
      const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6, max: 1.6 });
      // 4 ms of GPU time at the preset's cap: 2.56x the pixels still fit.
      const s = run(dr, (k) => 4 * k * k, 20);
      expect(s[s.length - 1]).toBeCloseTo(1.6, 5);
    });

    it('stops where the measured frame would no longer fit', () => {
      const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6, max: 1.6 });
      const s = run(dr, (k) => 9 * k * k, 30);
      const settled = s[s.length - 1] as number;
      expect(settled).toBeGreaterThan(1);
      expect(9 * settled * settled).toBeLessThanOrEqual(16.67);
    });

    it('with only a vsync-capped frame interval, probes up while 60 fps holds', () => {
      const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6, max: 1.6 });
      // A phone that holds vsync up to 1.3x the cap, then drops to 30 fps.
      const s = run(dr, (k) => (k <= 1.3 + 1e-9 ? 16.67 : 33.3), 60);
      const last = s.slice(-600);
      expect(Math.max(...last)).toBeLessThanOrEqual(1.3 + 1e-9);
      expect(last[last.length - 1]).toBeGreaterThan(1.15);
    });

    it('after a failed probe, does not retry that size for 30 s (no visible hunting)', () => {
      const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6, max: 1.6 });
      const s = run(dr, (k) => (k <= 1.2 + 1e-9 ? 16.67 : 33.3), 120);
      let changes = 0;
      for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) changes++;
      // Two minutes: at most one failed probe each 30 s, each a step up and a step down.
      expect(changes).toBeLessThanOrEqual(12);
    });

    it('without max, never goes above the cap', () => {
      const dr = new DynamicResolution({ targetMs: 16.67, min: 0.6 });
      const s = run(dr, () => 3, 20);
      expect(Math.max(...s)).toBe(1);
    });
  });
});
