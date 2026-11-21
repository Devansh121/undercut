import type { RoomDeps } from '@undercut/protocol';

/** Uniform integer in [0, n) from the platform's cryptographic generator, without bias. */
export function randomInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new RangeError('bad range');
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0] as number;
    if (v < limit) return v % n;
  }
}

/** 128 random bits as 32 hex digits. */
export function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const cryptoDeps: RoomDeps = { randomInt, token };
