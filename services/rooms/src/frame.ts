import { parseClientMessage, type ValidationError } from '@undercut/protocol';

/** What the room should do with one incoming WebSocket frame. */
export type FrameOutcome =
  { kind: 'hello'; name: string } | { kind: 'error'; error: ValidationError };

const INTERNAL: FrameOutcome = {
  kind: 'error',
  error: { code: 'internal_error', detail: 'the server could not handle this message' },
};

/**
 * Validate one frame and decide the response. Never throws, whatever the input:
 * anything unexpected becomes an `internal_error` the client can see.
 */
export function handleFrame(data: string | ArrayBuffer, parse = parseClientMessage): FrameOutcome {
  try {
    if (typeof data !== 'string') {
      return {
        kind: 'error',
        error: { code: 'bad_message', detail: 'only text frames are accepted' },
      };
    }
    const result = parse(data);
    if (!result.ok) return { kind: 'error', error: result.error };
    switch (result.message.type) {
      case 'hello':
        return { kind: 'hello', name: result.message.name };
    }
  } catch {
    return INTERNAL;
  }
}
