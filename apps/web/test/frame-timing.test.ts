import { describe, expect, it } from 'vitest';
import { BACKUP_STEP_MS, LATE_FRAME_MS, physicsDt, stepWithoutFrame } from '../src/frame-timing';

describe('frame timing', () => {
  it('caps the physics step after a stall, never the elapsed time', () => {
    expect(physicsDt(16.7)).toBeCloseTo(0.0167, 6);
    expect(physicsDt(1000)).toBe(0.25);
    expect(physicsDt(0)).toBe(0);
  });
});

describe('stepWithoutFrame', () => {
  it('waits for a late animation frame before stepping from the timer', () => {
    expect(stepWithoutFrame(1000, 1000, true)).toBe(false);
    expect(stepWithoutFrame(1000 + LATE_FRAME_MS - 1, 1000, true)).toBe(false);
    expect(stepWithoutFrame(1000 + LATE_FRAME_MS + 0.01, 1000, true)).toBe(true);
    expect(stepWithoutFrame(1000 + 400, 1000, true)).toBe(true);
  });

  it('never steps a hidden page or before the first frame', () => {
    expect(stepWithoutFrame(5000, 1000, false)).toBe(false);
    expect(stepWithoutFrame(5000, null, true)).toBe(false);
  });

  it('steps often enough for a 30 Hz snapshot cadence and a 250 ms extrapolation window', () => {
    // A timer step at most every BACKUP_STEP_MS once LATE_FRAME_MS has passed: the newest pose a
    // peer can hold is never older than their sum plus the link's latency.
    expect(BACKUP_STEP_MS).toBeLessThanOrEqual(1000 / 30 + 1e-9);
    expect(LATE_FRAME_MS + BACKUP_STEP_MS).toBeLessThanOrEqual(2 * (1000 / 30) + 1e-9);
    // A 60 Hz display's frames are never late.
    expect(stepWithoutFrame(1000 + 1000 / 60, 1000, true)).toBe(false);
  });
});
