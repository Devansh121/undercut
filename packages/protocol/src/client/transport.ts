/**
 * How the client reaches the room: a strategy so the same client runs over a browser
 * WebSocket, the `ws` package in Node, or the network simulator in tests.
 */

export interface TransportHandlers {
  onOpen(): void;
  onText(text: string): void;
  onBinary(data: Uint8Array): void;
  /** Called once, whether the close was clean or not. */
  onClose(code: number, reason: string): void;
}

export interface Connection {
  sendText(text: string): void;
  sendBinary(data: Uint8Array): void;
  /** Bytes queued but not yet sent; used for backpressure. */
  readonly bufferedAmount: number;
  close(code?: number, reason?: string): void;
}

export interface Transport {
  open(url: string, handlers: TransportHandlers): Connection;
}

/**
 * The subset of the WHATWG WebSocket the adapter uses. A browser `WebSocket` and the
 * `ws` package's `WebSocket` both fit.
 */
export interface WebSocketLike {
  binaryType: string;
  readonly bufferedAmount: number;
  readonly readyState: number;
  onopen: ((ev: never) => unknown) | null;
  onmessage: ((ev: never) => unknown) | null;
  onclose: ((ev: never) => unknown) | null;
  onerror: ((ev: never) => unknown) | null;
  send(data: string | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;

/** Adapt any WebSocket constructor (passed in, so this package needs no DOM). */
export function webSocketTransport(create: (url: string) => WebSocketLike): Transport {
  return {
    open(url, handlers) {
      let closed = false;
      const finish = (code: number, reason: string) => {
        if (closed) return;
        closed = true;
        handlers.onClose(code, reason);
      };
      let ws: WebSocketLike;
      try {
        ws = create(url);
      } catch {
        // Report asynchronously, like a socket that failed to connect.
        void Promise.resolve().then(() => finish(1006, 'could not open'));
        return { sendText() {}, sendBinary() {}, bufferedAmount: 0, close() {} };
      }
      ws.binaryType = 'arraybuffer';
      ws.onopen = (() => handlers.onOpen()) as (ev: never) => unknown;
      ws.onmessage = ((ev: { data: unknown }) => {
        const data = ev.data;
        if (typeof data === 'string') handlers.onText(data);
        else if (data instanceof ArrayBuffer) handlers.onBinary(new Uint8Array(data));
        else if (ArrayBuffer.isView(data)) {
          handlers.onBinary(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        }
      }) as (ev: never) => unknown;
      ws.onclose = ((ev: { code: number; reason: string }) => finish(ev.code, ev.reason)) as (
        ev: never,
      ) => unknown;
      ws.onerror = (() => {
        // A close event always follows an error.
      }) as (ev: never) => unknown;
      return {
        sendText(text) {
          if (ws.readyState === OPEN) ws.send(text);
        },
        sendBinary(data) {
          if (ws.readyState === OPEN) ws.send(data);
        },
        get bufferedAmount() {
          return ws.bufferedAmount;
        },
        close(code, reason) {
          try {
            ws.close(code, reason);
          } catch {
            ws.close();
          }
        },
      };
    },
  };
}
