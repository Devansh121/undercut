import { describe, expect, it } from 'vitest';
import { physicsDt } from '../src/frame-timing';

describe('frame timing', () => {
  it('caps the physics step after a stall, never the elapsed time', () => {
    expect(physicsDt(16.7)).toBeCloseTo(0.0167, 6);
    expect(physicsDt(1000)).toBe(0.25);
    expect(physicsDt(0)).toBe(0);
  });
});
