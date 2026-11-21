import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  PROTOCOL_VERSION,
  encodeServerMessage,
  isRoomId,
  parseClientMessage,
} from '../src/index';

const hello = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'Ana', ...fields });

describe('parseClientMessage: hello', () => {
  it('accepts a well-formed hello', () => {
    expect(parseClientMessage(hello())).toEqual({
      ok: true,
      message: { type: 'hello', v: PROTOCOL_VERSION, name: 'Ana' },
    });
  });

  it('trims and NFC-normalises the name', () => {
    const result = parseClientMessage(hello({ name: '  Rene\u0301  ' }));
    expect(result).toEqual({
      ok: true,
      message: { type: 'hello', v: PROTOCOL_VERSION, name: 'Ren\u00e9' },
    });
  });

  it('accepts a name at the length limit and rejects one over it', () => {
    expect(parseClientMessage(hello({ name: 'x'.repeat(MAX_NAME_LENGTH) })).ok).toBe(true);
    expect(parseClientMessage(hello({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }))).toMatchObject({
      ok: false,
      error: { code: 'bad_message' },
    });
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['control characters', 'a\u0000b'],
    ['a newline', 'a\nb'],
    ['not a string', 42],
  ])('rejects a name that is %s', (_label, name) => {
    expect(parseClientMessage(hello({ name }))).toMatchObject({
      ok: false,
      error: { code: 'bad_message' },
    });
  });

  it('rejects a different protocol version with its own code', () => {
    expect(parseClientMessage(hello({ v: PROTOCOL_VERSION + 1 }))).toMatchObject({
      ok: false,
      error: { code: 'version_mismatch' },
    });
  });

  it('rejects unknown fields', () => {
    expect(parseClientMessage(hello({ admin: true }))).toMatchObject({
      ok: false,
      error: { code: 'bad_message' },
    });
  });
});

describe('parseClientMessage: envelope', () => {
  it('rejects text that is not JSON', () => {
    expect(parseClientMessage('{nope')).toMatchObject({ ok: false, error: { code: 'bad_json' } });
  });

  it.each([['null'], ['[]'], ['"hello"'], ['3']])('rejects non-object JSON %s', (raw) => {
    expect(parseClientMessage(raw)).toMatchObject({ ok: false, error: { code: 'bad_message' } });
  });

  it.each([
    ['an object whose toString is null', '{"type":{"toString":null}}'],
    ['a nested object', '{"type":{"type":"hello"}}'],
    ['an array', '{"type":["hello"]}'],
    ['a number', '{"type":1}'],
    ['null', '{"type":null}'],
    ['a boolean', '{"type":true}'],
    ['missing', '{"v":1,"name":"Ana"}'],
  ])('rejects a type that is %s without coercing it', (_label, raw) => {
    expect(() => parseClientMessage(raw)).not.toThrow();
    expect(parseClientMessage(raw)).toMatchObject({ ok: false, error: { code: 'bad_message' } });
  });

  it.each([
    ['name', { name: { toString: null } }],
    ['name', { name: ['Ana'] }],
    ['name', { name: { first: 'Ana' } }],
    ['v', { v: { valueOf: null } }],
    ['v', { v: [PROTOCOL_VERSION] }],
    ['v', { v: String(PROTOCOL_VERSION) }],
  ])('rejects a hello whose %s is not a plain value of the right type', (_field, fields) => {
    const raw = hello(fields);
    expect(() => parseClientMessage(raw)).not.toThrow();
    expect(parseClientMessage(raw)).toMatchObject({ ok: false, error: { code: 'bad_message' } });
  });

  it('never throws on arbitrary JSON values', () => {
    const samples = [
      '{}',
      '{"type":"hello","v":1,"name":"A","__proto__":{"x":1}}',
      '{"type":"hello","v":1,"name":{"toString":null,"valueOf":null}}',
      '{"type":"\u0000"}',
      '[{"type":"hello"}]',
      '{"type":"hello","v":1e999,"name":"A"}',
      '""',
      'true',
    ];
    for (const raw of samples) {
      const result = parseClientMessage(raw);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects an unknown type', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'teleport' }))).toMatchObject({
      ok: false,
      error: { code: 'unknown_type' },
    });
  });

  it('rejects a message over the size limit before parsing it', () => {
    const raw = hello({ name: 'a', pad: 'x'.repeat(MAX_MESSAGE_LENGTH) });
    expect(parseClientMessage(raw)).toMatchObject({ ok: false, error: { code: 'too_large' } });
  });
});

describe('encodeServerMessage', () => {
  it('round-trips a presence message through JSON', () => {
    const message = {
      type: 'presence',
      you: 'p1',
      peers: [{ id: 'p1', name: 'Ana' }],
    } as const;
    expect(JSON.parse(encodeServerMessage(message))).toEqual(message);
  });
});

describe('isRoomId', () => {
  it.each(['a', 'ABC123', 'room_1-b', 'x'.repeat(32)])('accepts %s', (id) => {
    expect(isRoomId(id)).toBe(true);
  });

  it.each(['', 'x'.repeat(33), 'has space', 'slash/inside', '..', '\u00e9'])('rejects %s', (id) => {
    expect(isRoomId(id)).toBe(false);
  });
});
