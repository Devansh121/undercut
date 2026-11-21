import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 1000; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 32 }, () => a.nextUint32() === b.nextUint32());
    expect(same.filter(Boolean).length).toBeLessThan(2);
  });

  it('does not collapse to zero for a zero seed', () => {
    const rng = createRng(0);
    const values = Array.from({ length: 8 }, () => rng.nextUint32());
    expect(new Set(values).size).toBe(8);
  });

  it('returns unsigned 32-bit integers', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.nextUint32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('returns floats in [0, 1) with a mean near one half', () => {
    const rng = createRng(99);
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    // Standard error of the mean is ~0.0009 for n = 1e5; 0.005 is over five sigma.
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.005);
  });

  it('range(min, max) stays within [min, max)', () => {
    const rng = createRng(3);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.range(-2.5, 4);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4);
    }
  });

  it('int(min, max) is inclusive at both ends and hits every value', () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(-3, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it('int rejects an empty or non-integer range', () => {
    const rng = createRng(5);
    expect(() => rng.int(4, 3)).toThrow(RangeError);
    expect(() => rng.int(0.5, 3)).toThrow(RangeError);
  });

  it('restores a saved state and continues the identical sequence', () => {
    const rng = createRng(2024);
    for (let i = 0; i < 17; i++) rng.next();
    const saved = rng.getState();
    const expected = Array.from({ length: 50 }, () => rng.nextUint32());
    const restored = createRng(0);
    restored.setState(saved);
    expect(Array.from({ length: 50 }, () => restored.nextUint32())).toEqual(expected);
  });

  it('keeps the state as a copy, not a live reference', () => {
    const rng = createRng(11);
    const saved = rng.getState();
    rng.next();
    expect(rng.getState()).not.toEqual(saved);
  });

  it('is stable across releases (regression lock on the first outputs)', () => {
    // These values pin the algorithm (sfc32 seeded through splitmix32, cross-checked
    // against the reference sfc32 implementation when first written). Changing
    // them changes every seeded session, replay and test fixture.
    const rng = createRng(42);
    expect(Array.from({ length: 4 }, () => rng.nextUint32())).toMatchInlineSnapshot(`
      [
        1028872839,
        2516511472,
        400437680,
        853279530,
      ]
    `);
  });
});
