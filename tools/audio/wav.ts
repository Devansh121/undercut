/** 16-bit PCM WAV encoding, no dependencies. */

/** Encode interleaved 16-bit PCM. Samples are clamped to ±1 and rounded (no dither). */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * count * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, count, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * count * 2, true);
  v.setUint16(32, count * 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const x = Math.max(-1, Math.min(1, (channels[c] as Float32Array)[i] as number));
      v.setInt16(offset, Math.round(x < 0 ? x * 32768 : x * 32767), true);
      offset += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Decode what `encodeWav` writes (16-bit PCM only). */
export function decodeWav(bytes: Uint8Array): { sampleRate: number; channels: Float32Array[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const dataBytes = v.getUint32(40, true);
  const frames = dataBytes / (2 * count);
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const s = v.getInt16(offset, true);
      (channels[c] as Float32Array)[i] = s < 0 ? s / 32768 : s / 32767;
      offset += 2;
    }
  }
  return { sampleRate, channels };
}
