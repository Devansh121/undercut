import { describe, expect, it } from 'vitest';
import { AudioCore, type AudioCarState } from '../src/index';
import { engineState, identical } from './helpers';

/**
 * Output must not depend on how the host splits its blocks, including through the events
 * that fire within a block: limiter cuts, overrun pops and gear-change clacks.
 */
const DRIVES: Record<string, (t: number) => AudioCarState> = {
  // At the highest supported engine speed and the lowest rate, firing events are under one
  // control chunk apart, so one chunk can hold several pop triggers.
  'rev limiter on the overrun at 15 000 rpm': () =>
    engineState(15_000, 0.03, { throttle: 0.03, revLimiter: true }),
  'downshifts on the overrun at 15 000 rpm': (t) =>
    engineState(15_000, 0, { shifting: t % 0.08 < 0.06, shiftDirection: -1 }),
  'rev limiter at full load': (t) =>
    engineState(12_400 + 100 * Math.sin(80 * t), 1, { revLimiter: true, boost: 1 }),
  'pit limiter': () => engineState(7400, 0.85, { pitLimiter: true, throttle: 1, speed: 22 }),
  'lift with pops': (t) =>
    engineState(11_500 - 2000 * Math.max(0, t - 0.3), t < 0.3 ? 1 : 0, { boost: t < 0.3 ? 1 : 0 }),
  'rapid shifts': (t) =>
    engineState(9000 + 2500 * Math.sin(9 * t), t % 0.2 < 0.1 ? 1 : 0, {
      shifting: t % 0.1 < 0.04,
      shiftDirection: t % 0.2 < 0.1 ? 1 : -1,
      ersPower: -80_000,
      speed: 50,
      kerb: t > 0.5 ? 1 : 0,
      kerbFrequency: 40,
      bottoming: t > 0.7 && t < 0.75 ? 0.5 : 0,
    }),
};

function render(
  sampleRate: number,
  drive: (t: number) => AudioCarState,
  block: number,
  seconds = 3,
): Float32Array {
  const core = new AudioCore({ sampleRate, seed: 3 });
  const n = Math.round(seconds * sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const per = Math.round(sampleRate / 120);
  let frame = 0;
  let next = 0;
  while (frame < n) {
    if (frame >= next) {
      core.setCarState(drive(frame / sampleRate));
      next += per;
    }
    const m = Math.min(block, n - frame, next - frame);
    core.process([left.subarray(frame, frame + m), right.subarray(frame, frame + m)], m);
    frame += m;
  }
  return left;
}

describe('block-size independence with events', () => {
  for (const sampleRate of [22_050, 48_000]) {
    for (const [name, drive] of Object.entries(DRIVES)) {
      it(`${name} at ${sampleRate} Hz`, () => {
        const ref = render(sampleRate, drive, 1);
        for (const block of [7, 128, 4096]) {
          const other = render(sampleRate, drive, block);
          let first = -1;
          for (let i = 0; i < ref.length && first < 0; i++) if (ref[i] !== other[i]) first = i;
          expect(first, `block ${block}: first difference at sample ${first}`).toBe(-1);
          expect(identical(ref, other)).toBe(true);
        }
      });
    }
  }
});
