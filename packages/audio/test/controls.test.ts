import { describe, expect, it } from 'vitest';
import { CarControls, CHUNK } from '../src/dsp/controls';
import { L, LAYERS } from '../src/dsp/meters';
import { CAR_STATE_FIELDS, CAR_STATE_LENGTH, F } from '../src/dsp/state';
import { defaultCarState, packCarState, unpackCarState, type AudioCarState } from '../src/index';

describe('car state', () => {
  it('field indices match the packed field order', () => {
    CAR_STATE_FIELDS.forEach((name, i) => expect(F[name], name).toBe(i));
    expect(Object.keys(F)).toHaveLength(CAR_STATE_LENGTH);
    LAYERS.forEach((name, i) => expect(L[name], name).toBe(i));
  });

  it('packs and unpacks every field', () => {
    const s: AudioCarState = {
      engineOn: true,
      engineSpeed: 1234.5,
      throttle: 0.7,
      load: 0.6,
      gear: 5,
      shifting: true,
      shiftDirection: -1,
      revLimiter: true,
      pitLimiter: false,
      boost: 0.4,
      ersPower: -80_000,
      speed: 71.2,
      slipFront: 0.05,
      slipRear: 0.11,
      kerb: 0.9,
      kerbFrequency: 33,
      bottoming: 0.2,
      slipRatioFront: -0.4,
      slipRatioRear: 0.25,
      grass: 0.5,
      gravel: 0.25,
      drs: 1,
      impactSpeed: 7.5,
      impactSerial: 3,
    };
    const packed = packCarState(s, new Float64Array(CAR_STATE_LENGTH));
    expect(unpackCarState(packed, defaultCarState())).toEqual(s);
  });

  it('packs values as they are; validation happens in the core (invalid-input.test.ts)', () => {
    const s = { ...defaultCarState(), engineSpeed: Number.NaN, speed: Number.POSITIVE_INFINITY };
    const packed = packCarState(s, new Float64Array(CAR_STATE_LENGTH));
    expect(packed[F.engineSpeed]).toBeNaN();
    expect(packed[F.speed]).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('control interpolation', () => {
  it('keeps the sign of slip ratios and steps impact fields instead of ramping them', () => {
    const c = new CarControls(48_000);
    c.set({ ...defaultCarState(), slipRatioFront: 0, impactSpeed: 0, impactSerial: 0 });
    c.advance(CHUNK);
    c.set({ ...defaultCarState(), slipRatioFront: -0.6, impactSpeed: 9, impactSerial: 1 });
    c.advance(CHUNK);
    // Impact speed and serial take their new values at the update's first sample.
    expect(c.buffers[F.impactSpeed]?.[0]).toBe(9);
    expect(c.buffers[F.impactSerial]?.[0]).toBe(1);
    // The slip ratio ramps towards -0.6 and stays negative (a lock-up, not a spin).
    const last = c.buffers[F.slipRatioFront]?.[CHUNK - 1] as number;
    expect(last).toBeLessThan(0);
    expect(c.targetOf(F.slipRatioFront)).toBe(-0.6);
  });

  const at = (rpm: number, extra: Partial<AudioCarState> = {}) => ({
    ...defaultCarState(),
    engineSpeed: rpm,
    ...extra,
  });

  it('applies the first update at once', () => {
    const c = new CarControls(48_000);
    c.set(at(1000));
    c.advance(CHUNK);
    expect(c.buffers[F.engineSpeed]?.[0]).toBe(1000);
  });

  it('ramps linearly over the measured update interval, then holds', () => {
    const c = new CarControls(48_000);
    c.set(at(0));
    // Updates every 400 frames (120 Hz) establish the interval.
    for (let k = 0; k < 20; k++) {
      for (let f = 0; f < 400; f += CHUNK) c.advance(Math.min(CHUNK, 400 - f));
      c.set(at(0));
    }
    c.set(at(400));
    const values: number[] = [];
    for (let f = 0; f < 800; f += CHUNK) {
      const n = Math.min(CHUNK, 800 - f);
      c.advance(n);
      for (let i = 0; i < n; i++) values.push(c.buffers[F.engineSpeed]?.[i] as number);
    }
    expect(values[0]).toBeCloseTo(1, 6);
    expect(values[199]).toBeCloseTo(200, 6);
    expect(values[399]).toBe(400);
    expect(values[799]).toBe(400);
    // Continuous: no step larger than the ramp's own slope.
    for (let i = 1; i < values.length; i++)
      expect(Math.abs((values[i] as number) - (values[i - 1] as number))).toBeLessThanOrEqual(
        1 + 1e-9,
      );
  });

  it('switches flags at the update, without a ramp', () => {
    const c = new CarControls(48_000);
    c.set(at(0));
    c.advance(CHUNK);
    c.set(at(0, { shifting: true, gear: 4 }));
    c.advance(1);
    expect(c.buffers[F.shifting]?.[0]).toBe(1);
    expect(c.buffers[F.gear]?.[0]).toBe(4);
  });
});
