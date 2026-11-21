import { DurableObject } from 'cloudflare:workers';
import { encodeServerMessage, type PeerInfo, type ServerMessage } from '@undercut/protocol';
import { handleFrame } from './frame';

/** Per-socket data. Stored as a socket attachment so it survives hibernation. */
interface Peer {
  id: string;
  /** Null until the peer has sent a valid hello. */
  name: string | null;
}

/**
 * One room. M0 behaviour: validate every message with the shared protocol, and
 * broadcast presence (who has said hello) whenever it changes. The clock, grid,
 * start procedure and results arrive in M5.
 */
export class Room extends DurableObject {
  override async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const peer: Peer = { id: crypto.randomUUID(), name: null };
    server.serializeAttachment(peer);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    // No input may throw out of here: an uncaught exception would leave the client
    // without an answer. Anything unexpected is reported as a protocol error.
    try {
      const outcome = handleFrame(data);
      if (outcome.kind === 'error') {
        send(ws, { type: 'error', ...outcome.error });
        return;
      }
      const peer = ws.deserializeAttachment() as Peer;
      ws.serializeAttachment({ ...peer, name: outcome.name } satisfies Peer);
      this.broadcastPresence();
    } catch {
      send(ws, {
        type: 'error',
        code: 'internal_error',
        detail: 'the server could not handle this message',
      });
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // 1005 and 1006 are reserved and cannot be sent back.
    const reply = code === 1005 || code === 1006 ? 1000 : code;
    try {
      ws.close(reply, 'closing');
    } catch {
      // Already closed.
    }
    this.broadcastPresence(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws);
  }

  private broadcastPresence(leaving?: WebSocket): void {
    const sockets = this.ctx
      .getWebSockets()
      .filter((s) => s !== leaving && s.readyState === WebSocket.OPEN);
    const peers: PeerInfo[] = [];
    for (const s of sockets) {
      const peer = s.deserializeAttachment() as Peer;
      if (peer.name !== null) peers.push({ id: peer.id, name: peer.name });
    }
    for (const s of sockets) {
      const peer = s.deserializeAttachment() as Peer;
      if (peer.name !== null) send(s, { type: 'presence', you: peer.id, peers });
    }
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(encodeServerMessage(message));
  } catch {
    // The socket closed between the check and the send; presence will catch up.
  }
}
