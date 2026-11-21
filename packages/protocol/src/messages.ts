/** Bumped on any incompatible change to the messages below. */
export const PROTOCOL_VERSION = 1;

/** Longest client message accepted, in UTF-16 code units, checked before parsing. */
export const MAX_MESSAGE_LENGTH = 1024;

/** Longest display name, in code points after trimming and NFC normalisation. */
export const MAX_NAME_LENGTH = 24;

// ---- Client to server -------------------------------------------------------

/** First message a client sends after the socket opens. */
export interface HelloMessage {
  type: 'hello';
  v: typeof PROTOCOL_VERSION;
  name: string;
}

export type ClientMessage = HelloMessage;

// ---- Server to client -------------------------------------------------------

export interface PeerInfo {
  id: string;
  name: string;
}

/** Everyone in the room who has said hello. `you` is the recipient's own peer id. */
export interface PresenceMessage {
  type: 'presence';
  you: string;
  peers: readonly PeerInfo[];
}

export type ErrorCode =
  'bad_json' | 'bad_message' | 'too_large' | 'unknown_type' | 'version_mismatch';

/** Sent when a client message is rejected. The socket stays open. */
export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  detail: string;
}

export type ServerMessage = PresenceMessage | ErrorMessage;

// ---- Validation -------------------------------------------------------------

export interface ValidationError {
  code: ErrorCode;
  detail: string;
}

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: ValidationError };

const fail = (code: ErrorCode, detail: string): { ok: false; error: ValidationError } => ({
  ok: false,
  error: { code, detail },
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Control characters (C0, DEL, C1) and the line and paragraph separators.
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/u;

function parseHello(obj: Record<string, unknown>): ParseResult<HelloMessage> {
  const extra = Object.keys(obj).filter((k) => k !== 'type' && k !== 'v' && k !== 'name');
  if (extra.length > 0) return fail('bad_message', `unknown field: ${extra[0]}`);
  if (obj.v !== PROTOCOL_VERSION) {
    return fail('version_mismatch', `server speaks protocol ${PROTOCOL_VERSION}`);
  }
  if (typeof obj.name !== 'string') return fail('bad_message', 'name must be a string');
  const name = obj.name.normalize('NFC').trim();
  if (name.length === 0) return fail('bad_message', 'name is empty');
  if ([...name].length > MAX_NAME_LENGTH) {
    return fail('bad_message', `name is longer than ${MAX_NAME_LENGTH} characters`);
  }
  if (CONTROL_CHARS.test(name)) return fail('bad_message', 'name contains control characters');
  return { ok: true, message: { type: 'hello', v: PROTOCOL_VERSION, name } };
}

/** Parse and validate one text frame from a client. Never throws. */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  if (raw.length > MAX_MESSAGE_LENGTH) {
    return fail('too_large', `messages are limited to ${MAX_MESSAGE_LENGTH} characters`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail('bad_json', 'message is not valid JSON');
  }
  if (!isPlainObject(value)) return fail('bad_message', 'message must be a JSON object');
  switch (value.type) {
    case 'hello':
      return parseHello(value);
    default:
      return fail('unknown_type', `unknown message type: ${String(value.type).slice(0, 32)}`);
  }
}

/** Serialise a server message for the wire. */
export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** Room ids appear in the URL path `/rooms/<id>`. */
export function isRoomId(id: string): boolean {
  return ROOM_ID.test(id);
}
