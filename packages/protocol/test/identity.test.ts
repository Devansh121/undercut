import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import {
  MAX_NAME_LENGTH,
  ROOM_CODE_ALPHABET,
  generateRoomCode,
  normalizeRoomCode,
  sanitizeName,
} from '../src/index';

describe('room codes', () => {
  it('use no vowels and no look-alike characters', () => {
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[AEIOUYL01]/);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('are six characters from the alphabet and spread over it', () => {
    const rng = createRng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = generateRoomCode((n) => rng.int(0, n - 1));
      expect(code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{6}$`));
      seen.add(code);
    }
    expect(seen.size).toBe(2000);
  });

  it.each([
    ['bcdfgh', 'BCDFGH'],
    [' BCD-FGH ', 'BCDFGH'],
    ['bcd fgh', 'BCDFGH'],
  ])('normalises %j', (raw, code) => {
    expect(normalizeRoomCode(raw)).toBe(code);
  });

  it.each(['', 'BCDFG', 'BCDFGHJ', 'BCDFGA', 'BCDFG0', 'x'.repeat(100), 42, null, ['BCDFGH']])(
    'rejects %j',
    (raw) => {
      expect(normalizeRoomCode(raw)).toBeNull();
    },
  );
});

describe('sanitizeName', () => {
  it.each([
    ['Ana', 'Ana'],
    ['  René  ', 'René'],
    ['A\u0000n​a', 'Ana'],
    ['Ana‮evil', 'Anaevil'],
    ['Ana   \t  Ben', 'Ana Ben'],
    ['x'.repeat(MAX_NAME_LENGTH), 'x'.repeat(MAX_NAME_LENGTH)],
  ])('turns %j into %j', (raw, name) => {
    expect(sanitizeName(raw)).toBe(name);
  });

  it.each(['', '   ', '​​', '\u0000', 'x'.repeat(MAX_NAME_LENGTH + 1), 42, null, {}])(
    'rejects %j',
    (raw) => {
      expect(sanitizeName(raw)).toBeNull();
    },
  );
});
