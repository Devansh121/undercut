/**
 * Room service entry. One Durable Object per room owns that room's sockets and state.
 *
 *   GET /rooms/health          liveness, JSON
 *   GET /rooms/<id> (upgrade)  room WebSocket
 *
 * Paths keep the `/rooms` prefix so the same Worker can sit behind any origin's
 * `/rooms/*` route; the local server proxies that prefix here unchanged.
 */
import { PROTOCOL_VERSION, isRoomId } from '@undercut/protocol';
import { Room } from './room';

export { Room };

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

    if (path === '/health' || path === '/rooms/health') {
      return json({ ok: true, service: 'rooms', protocol: PROTOCOL_VERSION });
    }

    const match = /^\/rooms\/([^/]+)$/.exec(path);
    const roomId = match?.[1];
    if (roomId === undefined || !isRoomId(roomId)) return json({ error: 'not_found' }, 404);

    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'expected a WebSocket upgrade' }, 426);
    }
    return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request);
  },
} satisfies ExportedHandler<Env>;
