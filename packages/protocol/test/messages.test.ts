import { createRng, type Rng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  PROTOCOL_VERSION,
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '../src/index';

const join = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'join', v: PROTOCOL_VERSION, name: 'Ana', ...fields });

/** One valid example of every client message type. */
const VALID: Record<ClientMessage['type'], Record<string, unknown>> = {
  join: { type: 'join', v: PROTOCOL_VERSION, name: 'Ana', resume: 'a'.repeat(32) },
  ping: { type: 'ping', id: 3, t: 1234.5 },
  ready: { type: 'ready', ready: true },
  settings: { type: 'settings', patch: { laps: 3, aiSkill: 0.5 } },
  kick: { type: 'kick', member: 'm2' },
  loaded: { type: 'loaded' },
  lap: {
    type: 'lap',
    seat: 4,
    lap: 2,
    lapMs: 81234,
    raceMs: 165000,
    sectorsMs: [27000, 27000, 27234],
    tick: 9000,
    s: 3.2,
    speed: 80.5,
    at: 1.7e12,
  },
  limits: { type: 'limits', seat: 4, lap: 2 },
  jump_start: { type: 'jump_start', seat: 4 },
  pit: { type: 'pit', seat: 4, event: 'entry', lap: 2, at: 1.7e12 },
  retire: { type: 'retire', seat: 4 },
  rematch: { type: 'rematch' },
  leave: { type: 'leave' },
};

describe('parseClientMessage: every message type', () => {
  it.each(Object.entries(VALID))('accepts a well-formed %s', (_type, message) => {
    const result = parseClientMessage(JSON.stringify(message));
    expect(result).toEqual({ ok: true, message });
  });

  it.each(Object.entries(VALID))('rejects %s with an unknown field', (_type, message) => {
    expect(parseClientMessage(JSON.stringify({ ...message, admin: true }))).toMatchObject({
      ok: false,
      error: { code: 'bad_message' },
    });
  });

  it.each(Object.entries(VALID).filter(([, m]) => Object.keys(m).length > 1))(
    'rejects %s with each required field missing',
    (_type, message) => {
      for (const key of Object.keys(message)) {
        if (key === 'type' || key === 'resume' || key === 'sectorsMs') continue;
        const copy = { ...message };
        delete copy[key];
        expect(parseClientMessage(JSON.stringify(copy)), key).toMatchObject({ ok: false });
      }
    },
  );

  it.each([
    ['ping', { id: -1 }],
    ['ping', { id: 1.5 }],
    ['ready', { ready: 'yes' }],
    ['ready', { ready: 1 }],
    ['kick', { member: 'admin' }],
    ['kick', { member: ['m2'] }],
    ['lap', { seat: 20 }],
    ['lap', { seat: -1 }],
    ['lap', { lap: 0 }],
    ['lap', { lapMs: 0 }],
    ['lap', { lapMs: '81234' }],
    ['lap', { s: -1 }],
    ['lap', { speed: 1e9 }],
    ['lap', { sectorsMs: [1, 2, 3, 4, 5, 6, 7, 8, 9] }],
    ['lap', { sectorsMs: [1, 'x'] }],
    ['pit', { event: 'teleport' }],
    ['settings', { patch: { laps: 0 } }],
    ['settings', { patch: { laps: 100 } }],
    ['settings', { patch: { aiCount: 20 } }],
    ['settings', { patch: { aiSkill: 1.5 } }],
    ['settings', { patch: { gridOrder: 'reverse' } }],
    ['settings', { patch: { circuit: { id: 'x' } } }],
    ['settings', { patch: { assists: { abs: true } } }],
    ['settings', { patch: { unknown: 1 } }],
    ['settings', { patch: [] }],
    ['join', { resume: 'not-a-token' }],
    ['join', { resume: 'A'.repeat(32) }],
  ] as const)('rejects %s with %j', (type, fields) => {
    const raw = JSON.stringify({ ...VALID[type], ...fields });
    expect(parseClientMessage(raw)).toMatchObject({ ok: false, error: { code: 'bad_message' } });
  });

  it('enforces a size limit per message type', () => {
    const raw = JSON.stringify({ type: 'ready', ready: true, pad: 'x'.repeat(80) });
    expect(parseClientMessage(raw)).toMatchObject({ ok: false, error: { code: 'too_large' } });
  });
});

describe('parseClientMessage: join', () => {
  it('passes the raw name through for the room to sanitise', () => {
    expect(parseClientMessage(join({ name: '  Ana  ' }))).toMatchObject({
      ok: true,
      message: { name: '  Ana  ' },
    });
  });

  it('rejects a name far over the limit before it is sanitised', () => {
    expect(parseClientMessage(join({ name: 'x'.repeat(MAX_NAME_LENGTH * 8 + 1) }))).toMatchObject({
      ok: false,
    });
  });

  it('rejects a different protocol version with its own code', () => {
    expect(parseClientMessage(join({ v: PROTOCOL_VERSION + 1 }))).toMatchObject({
      ok: false,
      error: { code: 'version_mismatch' },
    });
    expect(parseClientMessage(join({ v: 1 }))).toMatchObject({
      ok: false,
      error: { code: 'version_mismatch' },
    });
  });
});

describe('parseClientMessage: envelope', () => {
  it('rejects text that is not JSON', () => {
    expect(parseClientMessage('{nope')).toMatchObject({ ok: false, error: { code: 'bad_json' } });
  });

  it.each([['null'], ['[]'], ['"join"'], ['3']])('rejects non-object JSON %s', (raw) => {
    expect(parseClientMessage(raw)).toMatchObject({ ok: false, error: { code: 'bad_message' } });
  });

  it.each([
    ['an object whose toString is null', '{"type":{"toString":null}}'],
    ['a nested object', '{"type":{"type":"join"}}'],
    ['an array', '{"type":["join"]}'],
    ['a number', '{"type":1}'],
    ['null', '{"type":null}'],
    ['a boolean', '{"type":true}'],
    ['missing', '{"v":2,"name":"Ana"}'],
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
  ])('rejects a join whose %s is not a plain value of the right type', (_field, fields) => {
    const raw = join(fields);
    expect(() => parseClientMessage(raw)).not.toThrow();
    expect(parseClientMessage(raw)).toMatchObject({ ok: false, error: { code: 'bad_message' } });
  });

  it('rejects __proto__ as an unknown field', () => {
    expect(parseClientMessage('{"type":"ping","id":1,"t":1,"__proto__":{"x":1}}')).toMatchObject({
      ok: false,
      error: { code: 'bad_message' },
    });
  });

  it('rejects an unknown type, including inherited property names', () => {
    for (const type of ['teleport', 'toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(parseClientMessage(JSON.stringify({ type }))).toMatchObject({
        ok: false,
        error: { code: 'unknown_type' },
      });
    }
  });

  it('rejects a message over the global size limit before parsing it', () => {
    const raw = join({ pad: 'x'.repeat(MAX_MESSAGE_LENGTH) });
    expect(parseClientMessage(raw)).toMatchObject({ ok: false, error: { code: 'too_large' } });
  });

  it('answers a non-string input without throwing', () => {
    for (const value of [null, undefined, 42, {}, [], new Uint8Array(3)]) {
      expect(parseClientMessage(value as unknown as string).ok).toBe(false);
    }
  });
});

// ---- Fuzz ----------------------------------------------------------------------

const HOSTILE_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'type', ''];

function hostile(rng: Rng, depth = 0): unknown {
  switch (rng.int(0, 13)) {
    case 0:
      return null;
    case 1:
      return rng.next() < 0.5;
    case 2:
      return Math.round((rng.next() - 0.5) * 2 ** 41);
    case 3:
      return [1e308, -1e308, 5e-324, -0, 2 ** 53 + 1, 0.1][rng.int(0, 5)];
    case 4:
      return 'x'.repeat(rng.int(0, 2000));
    case 5:
      return String.fromCharCode(
        ...Array.from({ length: rng.int(0, 40) }, () => rng.int(0, 0xffff)),
      );
    case 6:
      return ['join', 'lap', 'NaN', 'Infinity', '1e999', '\u0000', '\ud800', 'm1'][rng.int(0, 7)];
    case 7:
    case 8:
      if (depth > 3) return 0;
      return Array.from({ length: rng.int(0, 5) }, () => hostile(rng, depth + 1));
    default: {
      if (depth > 3) return {};
      const o: Record<string, unknown> = {};
      for (let i = rng.int(0, 5); i > 0; i--) {
        const key =
          rng.next() < 0.5 ? (HOSTILE_KEYS[rng.int(0, 6)] as string) : `k${rng.int(0, 9)}`;
        Object.defineProperty(o, key, {
          value: hostile(rng, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return o;
    }
  }
}

describe('parseClientMessage: fuzz', () => {
  const codes = new Set<string>(ERROR_CODES);

  it('never throws, and only ever accepts values of the declared types', () => {
    const rng = createRng(20261121);
    const types = Object.keys(VALID) as ClientMessage['type'][];
    let accepted = 0;
    for (let i = 0; i < 20_000; i++) {
      let raw: string;
      const mode = rng.int(0, 3);
      if (mode === 0) {
        raw = JSON.stringify(hostile(rng)) ?? 'null';
      } else if (mode === 1) {
        raw = String.fromCharCode(...Array.from({ length: rng.int(0, 64) }, () => rng.int(0, 127)));
      } else {
        // A valid message with one field replaced by a hostile value.
        const base = { ...VALID[types[rng.int(0, types.length - 1)] as ClientMessage['type']] };
        const keys = [...Object.keys(base), 'extra'];
        base[keys[rng.int(0, keys.length - 1)] as string] = hostile(rng);
        raw = JSON.stringify(base);
      }
      let result: ReturnType<typeof parseClientMessage> | undefined;
      expect(() => (result = parseClientMessage(raw))).not.toThrow();
      if (!result) throw new Error('unreachable');
      if (result.ok) {
        accepted++;
        // Whatever got through must survive a JSON round trip unchanged and have a known type.
        expect(VALID[result.message.type]).toBeDefined();
        expect(JSON.parse(JSON.stringify(result.message))).toEqual(result.message);
      } else {
        expect(codes.has(result.error.code)).toBe(true);
        expect(typeof result.error.detail).toBe('string');
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });
});

describe('server messages', () => {
  it('round-trip through the wire format', () => {
    const message: ServerMessage = { type: 'pong', id: 1, t: 2, now: 3 };
    expect(parseServerMessage(encodeServerMessage(message))).toEqual(message);
  });

  it.each(['', '{', 'null', '[]', '{"type":"presence"}', '{"type":3}'])(
    'parseServerMessage returns null for %s',
    (raw) => {
      expect(parseServerMessage(raw)).toBeNull();
    },
  );
});
