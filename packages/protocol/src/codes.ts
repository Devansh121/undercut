/**
 * Room codes: six characters from an alphabet with no vowels (so no words) and none
 * of the look-alikes 0/O, 1/I/L. 27^6 is about 3.9e8 codes (28.5 bits); a code is
 * only live while its room is, and creation is rate limited per client address.
 */
export const ROOM_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ23456789';
export const ROOM_CODE_LENGTH = 6;

const CODE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * Make a code from a source of uniform integers. `randomInt(n)` returns an integer in
 * [0, n); the service passes one backed by `crypto.getRandomValues`.
 */
export function generateRoomCode(randomInt: (n: number) => number): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)] ?? 'B';
  }
  return code;
}

/**
 * Accept what a person might type (lower case, spaces or a dash in the middle) and
 * return the canonical code, or null if it cannot be a room code.
 */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 16) return null;
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  return CODE.test(code) ? code : null;
}

/** Resume tokens: 128 random bits as 32 lower-case hex digits. */
export const RESUME_TOKEN = /^[0-9a-f]{32}$/;
