import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@undercut/protocol';
import { handleFrame } from '../src/frame';

describe('handleFrame', () => {
  it('turns a valid hello into a hello outcome', () => {
    expect(
      handleFrame(JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: 'Ana' })),
    ).toEqual({
      kind: 'hello',
      name: 'Ana',
    });
  });

  it('answers a binary frame with a protocol error', () => {
    expect(handleFrame(new ArrayBuffer(3))).toMatchObject({
      kind: 'error',
      error: { code: 'bad_message' },
    });
  });

  it('answers a type that cannot be coerced with a protocol error', () => {
    expect(handleFrame('{"type":{"toString":null}}')).toMatchObject({
      kind: 'error',
      error: { code: 'bad_message' },
    });
  });

  it('never throws: a failing parser becomes an internal_error outcome', () => {
    const explode = (): never => {
      throw new TypeError('boom');
    };
    expect(handleFrame('{}', explode)).toEqual({
      kind: 'error',
      error: { code: 'internal_error', detail: 'the server could not handle this message' },
    });
  });

  it.each([null, undefined, 42, {}, [] as unknown])(
    'never throws on a non-frame value %s',
    (data) => {
      expect(handleFrame(data as string).kind).toBe('error');
    },
  );
});
