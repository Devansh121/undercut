import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, encodePng } from './png';
import { decodeWav, encodeWav } from './wav';

describe('wav', () => {
  it('round-trips 16-bit stereo within one quantisation step', () => {
    const left = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 10) * 0.9);
    const right = Float32Array.from({ length: 480 }, (_, i) => Math.cos(i / 7) * -0.5);
    const bytes = encodeWav([left, right], 48_000);
    expect(bytes.length).toBe(44 + 480 * 4);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
    const { sampleRate, channels } = decodeWav(bytes);
    expect(sampleRate).toBe(48_000);
    for (let i = 0; i < 480; i++) {
      expect(Math.abs((channels[0]?.[i] as number) - (left[i] as number))).toBeLessThan(1 / 32_767);
      expect(Math.abs((channels[1]?.[i] as number) - (right[i] as number))).toBeLessThan(
        1 / 32_767,
      );
    }
  });

  it('clamps instead of wrapping', () => {
    const { channels } = decodeWav(encodeWav([Float32Array.of(1.5, -1.5)], 48_000));
    expect(channels[0]?.[0]).toBe(1);
    expect(channels[0]?.[1]).toBe(-1);
  });
});

describe('png', () => {
  it('uses the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });

  it('writes a valid RGB image', () => {
    const rgb = new Uint8Array(3 * 4 * 2).map((_, i) => i * 10);
    const png = encodePng(4, 2, rgb);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(4);
    expect(view.getUint32(20)).toBe(2);
    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(raw.length).toBe(2 * (1 + 4 * 3));
    expect([...raw.subarray(1, 13)]).toEqual([...rgb.subarray(0, 12)]);
  });
});
