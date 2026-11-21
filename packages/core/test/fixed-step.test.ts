import { describe, expect, it } from 'vitest';
import { FixedStepAccumulator } from '../src/fixed-step';

describe('FixedStepAccumulator', () => {
  it('runs no steps until a full step of time has elapsed', () => {
    const acc = new FixedStepAccumulator({ step: 0.01 });
    expect(acc.advance(0.004)).toBe(0);
    expect(acc.advance(0.004)).toBe(0);
    expect(acc.advance(0.004)).toBe(1);
  });

  it('runs one step per step of elapsed time and carries the remainder', () => {
    const acc = new FixedStepAccumulator({ step: 1 / 120 });
    let steps = 0;
    for (let i = 0; i < 60; i++) steps += acc.advance(1 / 60);
    expect(steps).toBe(120);
  });

  it('reports the interpolation factor between the last two states', () => {
    const acc = new FixedStepAccumulator({ step: 0.01 });
    acc.advance(0.025);
    expect(acc.alpha).toBeCloseTo(0.5, 9);
  });

  it('keeps alpha in [0, 1)', () => {
    const acc = new FixedStepAccumulator({ step: 1 / 240 });
    for (let i = 0; i < 1000; i++) {
      acc.advance(((i * 7919) % 33) / 1000);
      expect(acc.alpha).toBeGreaterThanOrEqual(0);
      expect(acc.alpha).toBeLessThan(1);
    }
  });

  it('clamps elapsed time after a stall so the sim does not spiral', () => {
    const acc = new FixedStepAccumulator({ step: 0.01, maxFrameTime: 0.25 });
    expect(acc.advance(10)).toBe(25);
    expect(acc.alpha).toBeCloseTo(0, 9);
  });

  it('treats negative, NaN and infinite elapsed time as no time', () => {
    const acc = new FixedStepAccumulator({ step: 0.01 });
    expect(acc.advance(-1)).toBe(0);
    expect(acc.advance(Number.NaN)).toBe(0);
    expect(acc.advance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(acc.alpha).toBe(0);
  });

  it('does not lose a step to floating-point remainder', () => {
    // 0.1 / 0.01 is 9.999999999999998 in binary floating point.
    const acc = new FixedStepAccumulator({ step: 0.01 });
    expect(acc.advance(0.1)).toBe(10);
  });

  it('can be reset', () => {
    const acc = new FixedStepAccumulator({ step: 0.01 });
    acc.advance(0.005);
    acc.reset();
    expect(acc.alpha).toBe(0);
    expect(acc.advance(0.005)).toBe(0);
  });

  it('rejects a non-positive step or a frame cap below one step', () => {
    expect(() => new FixedStepAccumulator({ step: 0 })).toThrow(RangeError);
    expect(() => new FixedStepAccumulator({ step: 0.1, maxFrameTime: 0.05 })).toThrow(RangeError);
  });
});
