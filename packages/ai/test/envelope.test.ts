import { describe, expect, it } from 'vitest';
import { EnvelopeModel, decodeEnvelope } from '../src/envelope/envelope';
import { syntheticEnvelope } from './fixtures';

describe('envelope model', () => {
  const env = syntheticEnvelope();
  const m = new EnvelopeModel(env);

  it('reproduces the table at grid points and interpolates between them', () => {
    expect(m.lateral(env.speeds[4]!, 1)).toBeCloseTo(env.lateral[1]![4]!, 9);
    const mid = 0.5 * (env.speeds[4]! + env.speeds[5]!);
    expect(m.lateral(mid, 1)).toBeCloseTo(0.5 * (env.lateral[1]![4]! + env.lateral[1]![5]!), 9);
    expect(m.lateral(mid, 1.1)).toBeCloseTo(0.5 * (m.lateral(mid, 1) + m.lateral(mid, 1.2)), 9);
  });

  it('extrapolates past both ends of the speed grid and the load range', () => {
    expect(m.lateral(200, 1)).toBeGreaterThan(m.lateral(100, 1));
    expect(m.lateral(50, 1.4)).toBeGreaterThan(m.lateral(50, 1.2));
    expect(m.brake(0, 1)).toBeGreaterThanOrEqual(0);
  });

  it('shares grip along the combined limit', () => {
    expect(m.remaining(0)).toBe(1);
    expect(m.remaining(1)).toBe(0);
    // p = 2: a circle.
    expect(m.remaining(0.6)).toBeCloseTo(0.8, 9);
  });

  it('reads and validates the committed file format', () => {
    const ok = decodeEnvelope({ ...env, inputsHash: 'x' });
    expect(ok.inputsHash).toBe('x');
    expect(() => decodeEnvelope({ ...env })).toThrow(/inputsHash/);
    expect(() => decodeEnvelope({ ...env, inputsHash: 'x', lateral: [[1]] })).toThrow();
    expect(() => decodeEnvelope({ ...env, inputsHash: 'x', combinedExponent: 0.5 })).toThrow();
  });
});
