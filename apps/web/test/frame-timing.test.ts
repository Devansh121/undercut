import { FixedStepAccumulator } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_STEP_MS,
  LATE_FRAME_MS,
  DriveFrameClock,
  physicsDt,
  stepWithoutFrame,
} from '../src/frame-timing';

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

describe('DriveFrameClock', () => {
  it.each([0, 0.1, -0.1])(
    'preserves presentation wall time with interleaved timer steps (offset %s ms)',
    (offset) => {
      const clock = new DriveFrameClock();
      let legacyStepAt = 0;
      const simDeltas: number[] = [];
      const legacyDeltas: number[] = [];
      let presentationMs = clock.frameElapsedMs(0);
      expect(clock.stepDt(0)).toBe(0);
      let lastFrameAt = 0;
      const callbacks: { at: number; frame: boolean }[] = [];
      for (let frame = 1; frame <= 50; frame++) callbacks.push({ at: frame * 200, frame: true });
      for (let tick = 1; tick < 300; tick++)
        callbacks.push({ at: tick * BACKUP_STEP_MS + offset, frame: false });
      callbacks.sort((a, b) => a.at - b.at || Number(a.frame) - Number(b.frame));
      for (const callback of callbacks) {
        const { at, frame } = callback;
        if (!frame && !stepWithoutFrame(at, lastFrameAt, true)) continue;
        if (frame) {
          const elapsedMs = clock.frameElapsedMs(at);
          expect(elapsedMs).toBe(200);
          presentationMs += elapsedMs;
          lastFrameAt = at;
        }
        const simDt = clock.stepDt(at);
        simDeltas.push(simDt);
        legacyDeltas.push(physicsDt(at - legacyStepAt));
        legacyStepAt = at;
      }
      expect(presentationMs).toBe(10_000);
      expect(simDeltas).toEqual(legacyDeltas);
      expect(simDeltas.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10);
      const accumulator = new FixedStepAccumulator({ step: 1 / 240 });
      expect(simDeltas.reduce((ticks, dt) => ticks + accumulator.advance(dt), 0)).toBe(2400);
    },
  );

  it('caps a stalled simulation without capping presentation elapsed time', () => {
    const clock = new DriveFrameClock();
    clock.frameElapsedMs(0);
    clock.stepDt(0);
    expect(clock.frameElapsedMs(1000)).toBe(1000);
    expect(clock.stepDt(1000)).toBe(0.25);
  });

  it('resets both clocks on resume without catching up paused time', () => {
    const clock = new DriveFrameClock();
    clock.stepDt(100);
    clock.frameElapsedMs(100);
    clock.reset();
    expect(clock.stepDt(10_000)).toBe(0);
    expect(clock.frameElapsedMs(10_000)).toBe(0);
  });
});
