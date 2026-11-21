/** Node glue for headless clients: real timers and the `ws` package as the transport. */
import WebSocket from 'ws';
import { webSocketTransport, type Timers, type WebSocketLike } from '@undercut/protocol';

/** Local monotonic-ish clock in ms on the Unix epoch scale (same machine as the service). */
export const realTimers: Timers = {
  now: () => performance.timeOrigin + performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export const wsTransport = webSocketTransport(
  (url) => new WebSocket(url) as unknown as WebSocketLike,
);
