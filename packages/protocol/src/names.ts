/** Longest display name, in code points after sanitising. */
export const MAX_NAME_LENGTH = 24;

// Control characters (C0, DEL, C1), format characters (bidi overrides, zero-width
// joiners, BOM) and the line and paragraph separators.
const STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const SPACES = /\s+/gu;

/**
 * Turn a client-supplied display name into the one shown to others: NFC-normalised,
 * invisible and control characters removed, runs of white space collapsed, trimmed.
 * Returns null when nothing printable is left or it is longer than MAX_NAME_LENGTH.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_NAME_LENGTH * 8) return null;
  const name = raw.normalize('NFC').replace(STRIP, '').replace(SPACES, ' ').trim();
  if (name.length === 0) return null;
  if ([...name].length > MAX_NAME_LENGTH) return null;
  return name;
}
