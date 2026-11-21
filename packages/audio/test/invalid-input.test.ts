import { describe, expect, it } from 'vitest';
import { magnitudeSpectrum, findPeak, rmsDbfs } from '../src/analysis/index';
import { CarControls } from '../src/dsp/controls';
import { F } from '../src/dsp/state';
import {
  AudioCore,
  CAR_STATE_LENGTH,
  packCarState,
  rpmToRadPerSecond,
  type AudioCarState,
} from '../src/index';
import { engineState, FS, render } from './helpers';

const GOOD = engineState(9000, 1, { boost: 0.8, ersPower: 60_000, speed: 60, slipFront: 0.05 });

function allFinite(x: Float32Array): boolean {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i] as number)) return false;
  return true;
}

let reference: Float32Array | undefined;
/** Render `bad` for 0.5 s, then GOOD for 1.5 s; return the clip and a clean reference. */
function recover(bad: AudioCarState | Float64Array) {
  const core = new AudioCore({ sampleRate: FS, seed: 2 });
  const clip = render(core, 2, (t) => (t < 0.5 ? bad : GOOD));
  reference ??= render(new AudioCore({ sampleRate: FS, seed: 2 }), 2, () => GOOD).left;
  return { clip, ref: { left: reference } };
}

function expectRecovered(name: string, bad: AudioCarState | Float64Array): void {
  const { clip, ref } = recover(bad);
  expect(allFinite(clip.left) && allFinite(clip.right), `${name}: finite throughout`).toBe(true);
  // Back to normal within 1 s of the first valid update: same level within 1 dB and the
  // firing frequency where it belongs.
  const tail = clip.left.subarray(Math.round(1.5 * FS));
  const refTail = ref.left.subarray(Math.round(1.5 * FS));
  expect(Math.abs(rmsDbfs(tail) - rmsDbfs(refTail)), `${name}: level`).toBeLessThan(1);
  const mags = magnitudeSpectrum(tail, tail.length - 16_384, 16_384, 65_536);
  expect(Math.abs(findPeak(mags, FS, 400, 500).frequency - 450), `${name}: pitch`).toBeLessThan(
    0.5,
  );
}

describe('invalid inputs', () => {
  it('a packed NaN engine speed neither breaks the output nor sticks', () => {
    const packed = packCarState(GOOD, new Float64Array(CAR_STATE_LENGTH));
    packed[F.engineSpeed] = Number.NaN;
    expectRecovered('packed NaN', packed);
  });

  it('a negative engine speed neither breaks the output nor sticks', () => {
    expectRecovered('negative speed', { ...GOOD, engineSpeed: -1000 });
  });

  it('every field at every kind of bad value, packed and as a struct', () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1e12, 1e12, -1];
    for (const value of bad) {
      const packed = new Float64Array(CAR_STATE_LENGTH).fill(value);
      expectRecovered(`packed all ${value}`, packed);
      const struct = { ...GOOD } as Record<string, unknown>;
      for (const key of Object.keys(struct))
        if (typeof struct[key] === 'number') struct[key] = value;
      expectRecovered(`struct all ${value}`, struct as unknown as AudioCarState);
    }
  }, 30_000);

  it('clamps every field to its supported range', () => {
    const c = new CarControls(FS);
    const packed = new Float64Array(CAR_STATE_LENGTH).fill(1e9);
    c.set(packed);
    c.advance(1);
    const v = (f: number) => c.buffers[f]?.[0] as number;
    expect(v(F.engineSpeed)).toBeLessThanOrEqual(rpmToRadPerSecond(15_000) + 1e-9);
    for (const f of [F.throttle, F.load, F.boost, F.kerb, F.bottoming, F.engineOn, F.shifting]) {
      expect(v(f)).toBeLessThanOrEqual(1);
    }
    expect(v(F.gear)).toBe(8);
    expect(v(F.shiftDirection)).toBe(1);
    expect(Math.abs(v(F.ersPower))).toBeLessThanOrEqual(200_000);
    expect(v(F.speed)).toBeLessThanOrEqual(150);
    expect(v(F.kerbFrequency)).toBeLessThanOrEqual(200);
    c.set(new Float64Array(CAR_STATE_LENGTH).fill(-1e9));
    c.advance(1);
    for (const f of [
      F.engineSpeed,
      F.throttle,
      F.load,
      F.boost,
      F.speed,
      F.slipFront,
      F.slipRear,
      F.kerb,
    ]) {
      expect(v(f)).toBeGreaterThanOrEqual(0);
    }
    expect(v(F.gear)).toBe(-1);
    expect(v(F.ersPower)).toBeGreaterThanOrEqual(-200_000);
  });

  it('a non-finite value keeps the last valid one', () => {
    const c = new CarControls(FS);
    c.set(packCarState(GOOD, new Float64Array(CAR_STATE_LENGTH)));
    c.advance(1);
    const packed = packCarState(GOOD, new Float64Array(CAR_STATE_LENGTH));
    packed[F.engineSpeed] = Number.NaN;
    c.set(packed);
    c.advance(32);
    expect(c.buffers[F.engineSpeed]?.[31]).toBeCloseTo(GOOD.engineSpeed, 9);
  });
});
