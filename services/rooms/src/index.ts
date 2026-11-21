/**
 * Room service entry. One Durable Object per room owns that room's sockets and state.
 *
 *   GET  /rooms/health        liveness, JSON
 *   POST /rooms               create a room; 201 { code, ... }
 *   GET  /rooms/<code>        does the room exist, can it be joined (for invite links)
 *   GET  /rooms/<code>/ws     the room WebSocket (upgrade)
 *
 * Paths keep the `/rooms` prefix so the same Worker can sit behind any origin's
 * `/rooms/*` route; the local server proxies that prefix here unchanged.
 */
import {
  MAX_HUMANS,
  PROTOCOL_VERSION,
  generateRoomCode,
  normalizeRoomCode,
} from '@undercut/protocol';
import { clientAddress } from './address';
import type { Env } from './env';
import { CreateLimiter } from './limiter';
import { randomInt } from './random';
import { Room } from './room';

export { CreateLimiter, Room };
export type { Env };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
    },
  });

/** Parse "count/windowMs"; defaults to 30 rooms per 10 minutes per address. */
export function parseCreateLimit(raw: string | undefined): { limit: number; windowMs: number } {
  const m = /^(\d{1,6})\/(\d{1,9})$/.exec(raw ?? '');
  if (!m) return { limit: 30, windowMs: 600_000 };
  return { limit: Number(m[1]), windowMs: Number(m[2]) };
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  const address = clientAddress(request);
  const { limit, windowMs } = parseCreateLimit(env.CREATE_LIMIT);
  const limiter = env.LIMITER.get(env.LIMITER.idFromName(address));
  if (!(await limiter.allow(limit, windowMs))) {
    return json({ error: 'rate_limited', detail: 'too many rooms created; try again later' }, 429);
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateRoomCode(randomInt);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    if (res.status === 201) {
      return json({ code, maxHumans: MAX_HUMANS, protocol: PROTOCOL_VERSION }, 201);
    }
    if (res.status !== 409) return json({ error: 'internal_error' }, 500);
  }
  return json({ error: 'internal_error', detail: 'no free room code' }, 503);
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (path === '/health' || path === '/rooms/health') {
      return json({ ok: true, service: 'rooms', protocol: PROTOCOL_VERSION });
    }
    if (path === '/rooms') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      return createRoom(request, env);
    }

    const match = /^\/rooms\/([^/]{1,32})(\/ws)?$/.exec(path);
    const code = match ? normalizeRoomCode(decodeURIComponent(match[1] ?? '')) : null;
    if (!match || code === null) return json({ error: 'not_found' }, 404);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));

    if (match[2] === '/ws') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json({ error: 'expected a WebSocket upgrade' }, 426);
      }
      return stub.fetch(new Request('https://room/ws', request));
    }
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const res = await stub.fetch('https://room/info');
    return json(await res.json(), res.status);
  },
} satisfies ExportedHandler<Env>;
