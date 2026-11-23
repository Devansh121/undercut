import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import {
  CAR_RECORD_BYTES,
  DOWN_HEADER_BYTES,
  MAX_CARS,
  UP_HEADER_BYTES,
  decodeDownFrame,
  decodeUpFrame,
  encodeDownFrame,
  encodeUpFrame,
  type CarSnapshot,
} from '../src/index';

const EPOCH = 1_700_000_000_000;

function randomCar(seed: number): CarSnapshot {
  const r = createRng(seed);
  return {
    seat: r.int(0, MAX_CARS - 1),
    flags: r.int(0, 63),
    resets: r.int(0, 3),
    tick: r.int(0, 2 ** 32 - 1),
    t: EPOCH + r.range(0, 3 * 3600_000),
    x: r.range(-3000, 3000),
    y: r.range(-200, 200),
    z: r.range(-3000, 3000),
    yaw: r.range(-Math.PI, Math.PI),
    pitch: r.range(-0.3, 0.3),
    roll: r.range(-0.3, 0.3),
    vx: r.range(-100, 100),
    vy: r.range(-10, 10),
    vz: r.range(-100, 100),
    yawRate: r.range(-5, 5),
    steer: r.range(-1, 1),
    throttle: r.next(),
    brake: r.next(),
    gear: r.int(-1, 8),
    rpm: r.range(0, 15000),
    wheelSpin: [r.range(-50, 400), r.range(-50, 400), r.range(-50, 400), r.range(-50, 400)],
    lap: r.int(0, 80),
    s: r.range(0, 7000),
  };
}

/** Documented worst-case error per field (snapshot.ts header), plus float slack. */
const BOUNDS: Record<string, number> = {
  t: 0.5,
  x: 0.0005,
  y: 0.0005,
  z: 0.0005,
  yaw: Math.PI / 32768 / 2,
  pitch: Math.PI / 32768 / 2,
  roll: Math.PI / 32768 / 2,
  vx: 0.005,
  vy: 0.005,
  vz: 0.005,
  yawRate: 0.0005,
  steer: 1 / 127 / 2,
  throttle: 1 / 255 / 2,
  brake: 1 / 255 / 2,
  rpm: 0.5,
  wheelSpin: 0.025,
  s: 0.0005,
};
const EPS = 1e-9;

describe('snapshot codec', () => {
  it('uses a 94-byte record including four recent board hits and a word of the broken set', () => {
    expect(CAR_RECORD_BYTES).toBe(94);
    expect(encodeUpFrame([randomCar(1)], EPOCH).byteLength).toBe(UP_HEADER_BYTES + 94);
    expect(encodeDownFrame([randomCar(1)], EPOCH, EPOCH).byteLength).toBe(DOWN_HEADER_BYTES + 94);
  });

  it('round-trips 10 000 random cars within the documented error bounds', () => {
    const worst: Record<string, number> = {};
    const failures: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const car = randomCar(i);
      const decoded = decodeUpFrame(encodeUpFrame([car], EPOCH), EPOCH);
      if (!decoded.ok) throw new Error(decoded.detail);
      const back = decoded.frame.cars[0] as CarSnapshot;
      for (const key of ['seat', 'flags', 'resets', 'tick', 'gear', 'lap'] as const) {
        if (back[key] !== car[key]) failures.push(`${key}: ${car[key]} -> ${back[key]}`);
      }
      for (const [key, bound] of Object.entries(BOUNDS)) {
        const a = car[key as keyof CarSnapshot];
        const b = back[key as keyof CarSnapshot];
        const errs = Array.isArray(a)
          ? a.map((v, j) => Math.abs(v - (b as number[])[j]!))
          : [Math.abs((a as number) - (b as number))];
        for (const err of errs) {
          worst[key] = Math.max(worst[key] ?? 0, err);
          if (err > bound + EPS) failures.push(`${key}: error ${err} over ${bound}`);
        }
      }
    }
    expect(failures).toEqual([]);
    // The bounds are tight: the worst observed error is close to each bound.
    for (const [key, bound] of Object.entries(BOUNDS)) {
      expect(worst[key], key).toBeGreaterThan(bound * 0.5);
    }
  });

  it('wraps angles and clamps out-of-range and non-finite values instead of throwing', () => {
    const car = {
      ...randomCar(3),
      yaw: 3 * Math.PI + 0.1,
      vx: 1e6,
      vy: Number.NaN,
      rpm: -5,
      steer: Number.POSITIVE_INFINITY,
      s: -1,
      gear: 12,
      t: EPOCH - 50,
    };
    const decoded = decodeUpFrame(encodeUpFrame([car], EPOCH), EPOCH);
    if (!decoded.ok) throw new Error(decoded.detail);
    const back = decoded.frame.cars[0] as CarSnapshot;
    expect(back.yaw).toBeCloseTo(-Math.PI + 0.1, 3);
    expect(back.vx).toBeCloseTo(327.67, 2);
    expect(back.vy).toBe(0);
    expect(back.rpm).toBe(0);
    expect(back.steer).toBe(0);
    expect(back.s).toBe(0);
    expect(back.gear).toBe(8);
    expect(back.t).toBe(EPOCH);
  });

  it('carries the server receive time in relay frames', () => {
    const cars = [randomCar(1), randomCar(2), randomCar(3)];
    const decoded = decodeDownFrame(encodeDownFrame(cars, EPOCH + 1234, EPOCH), EPOCH);
    expect(decoded.ok && decoded.frame.receivedAt).toBe(EPOCH + 1234);
    expect(decoded.ok && decoded.frame.cars.map((c) => c.seat)).toEqual(cars.map((c) => c.seat));
  });

  it('accepts a Uint8Array view at an offset', () => {
    const frame = encodeUpFrame([randomCar(5)], EPOCH);
    const padded = new Uint8Array(frame.byteLength + 7);
    padded.set(frame, 7);
    expect(decodeUpFrame(padded.subarray(7), EPOCH).ok).toBe(true);
  });

  it.each([
    ['empty', new Uint8Array(0)],
    ['header only', new Uint8Array([1, 1])],
    ['wrong kind', new Uint8Array([9, 0])],
    ['zero cars', new Uint8Array([1, 0])],
    ['too many cars', new Uint8Array([1, 21])],
  ])('rejects a malformed up frame: %s', (_label, bytes) => {
    expect(decodeUpFrame(bytes, EPOCH).ok).toBe(false);
  });

  it('rejects a frame whose length does not match its count, and a bad seat or gear', () => {
    const frame = encodeUpFrame([randomCar(1), randomCar(2)], EPOCH);
    expect(decodeUpFrame(frame.subarray(0, frame.byteLength - 1), EPOCH).ok).toBe(false);
    const extra = new Uint8Array(frame.byteLength + 1);
    extra.set(frame);
    expect(decodeUpFrame(extra, EPOCH).ok).toBe(false);
    const badSeat = frame.slice();
    badSeat[UP_HEADER_BYTES] = 20;
    expect(decodeUpFrame(badSeat, EPOCH)).toEqual({ ok: false, detail: 'seat out of range' });
    const badGear = frame.slice();
    badGear[UP_HEADER_BYTES + 39] = 9;
    expect(decodeUpFrame(badGear, EPOCH)).toEqual({ ok: false, detail: 'gear out of range' });
  });

  it('never throws on random bytes', () => {
    const rng = createRng(99);
    for (let i = 0; i < 5000; i++) {
      const bytes = new Uint8Array(rng.int(0, 200)).map(() => rng.int(0, 255));
      if (i % 3 === 0 && bytes.length > 1) bytes[0] = 1;
      expect(() => decodeUpFrame(bytes, EPOCH)).not.toThrow();
      expect(() => decodeDownFrame(bytes, EPOCH)).not.toThrow();
    }
  });

  it('keeps angle errors within half a step across the +-pi seam (review finding 8)', () => {
    const step = Math.PI / 32768;
    const circular = (a: number, b: number) => {
      const d = Math.abs(a - b) % (2 * Math.PI);
      return Math.min(d, 2 * Math.PI - d);
    };
    const angles: number[] = [];
    for (const edge of [Math.PI, -Math.PI]) {
      for (let k = -40; k <= 40; k++) angles.push(edge + k * 1e-6);
      for (const e of [1e-7, 1e-9, step / 2, step / 2 - 1e-9, step / 2 + 1e-9]) {
        angles.push(edge - e, edge + e);
      }
    }
    let worst = 0;
    for (const a of angles) {
      const decoded = decodeUpFrame(
        encodeUpFrame([{ ...randomCar(1), yaw: a, pitch: a, roll: a }], EPOCH),
        EPOCH,
      );
      if (!decoded.ok) throw new Error(decoded.detail);
      const back = decoded.frame.cars[0] as CarSnapshot;
      for (const v of [back.yaw, back.pitch, back.roll]) worst = Math.max(worst, circular(a, v));
    }
    expect(worst).toBeLessThanOrEqual(step / 2 + 1e-12);
  });

  it('carries a two-bit reset counter beside the flags', () => {
    for (let resets = 0; resets < 8; resets++) {
      const car = { ...randomCar(2), flags: 0b111111, resets };
      const decoded = decodeUpFrame(encodeUpFrame([car], EPOCH), EPOCH);
      if (!decoded.ok) throw new Error(decoded.detail);
      expect(decoded.frame.cars[0]).toMatchObject({ flags: 0b111111, resets: resets % 4 });
    }
  });
});

describe('breakable hit relay', () => {
  it('retains four hit ids, ages and impulses exactly at their canonical precision', () => {
    const car = randomCar(1);
    car.breakableHits = [4, 0.123, 24.51, -2.34, 5, 0.027, 2, 30, -1, 0, 0, 0, -1, 0, 0, 0];
    const result = decodeUpFrame(encodeUpFrame([car], EPOCH), EPOCH);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frame.cars[0]!.breakableHits).toEqual(car.breakableHits);
  });

  it('carries one 32-bit word of the broken set exactly, with its index', () => {
    const car = randomCar(2);
    car.brokenIndex = 63;
    car.brokenWord = 0x80000001;
    const result = decodeUpFrame(encodeUpFrame([car], EPOCH), EPOCH);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frame.cars[0]!.brokenIndex).toBe(63);
    expect(result.frame.cars[0]!.brokenWord).toBe(0x80000001);
    // Absent, the word reads as index 0 with no bits: nothing to merge.
    const plain = decodeUpFrame(encodeUpFrame([randomCar(3)], EPOCH), EPOCH);
    if (plain.ok) expect(plain.frame.cars[0]!.brokenWord ?? 0).toBe(0);
  });

  it('rejects a broken-set word index past the last word', () => {
    const bytes = encodeUpFrame([randomCar(4)], EPOCH);
    new DataView(bytes.buffer).setUint16(UP_HEADER_BYTES + 88, 64, true);
    expect(decodeUpFrame(bytes, EPOCH).ok).toBe(false);
  });
});
