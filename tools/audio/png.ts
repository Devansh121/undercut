/** Minimal PNG encoder (8-bit RGB) on node:zlib. */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode `rgb` (width × height × 3 bytes, row-major) as a PNG file. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  return encode(width, height, 2, 3, rgb, undefined);
}

/**
 * Encode a palette image: `pixels` holds one palette index per pixel, `palette` three bytes
 * (RGB) per entry, at most 256 entries. Much smaller than RGB for colour-mapped images.
 */
export function encodeIndexedPng(
  width: number,
  height: number,
  pixels: Uint8Array,
  palette: Uint8Array,
): Uint8Array {
  return encode(width, height, 3, 1, pixels, palette);
}

function encode(
  width: number,
  height: number,
  colourType: number,
  bytesPerPixel: number,
  data: Uint8Array,
  palette: Uint8Array | undefined,
): Uint8Array {
  const stride = width * bytesPerPixel;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colourType;
  const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    ...(palette ? [chunk('PLTE', palette)] : []),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
