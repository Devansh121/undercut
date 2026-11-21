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
import { parseCreateLimit } from './window';

export { CreateLimiter, Room };
export { parseCreateLimit };
export type { Env };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (body: unknown, status = 200, cors = true): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(cors ? CORS : {}),
    },
  });

/** Name of the one limiter instance that counts every creation, for GLOBAL_CREATE_LIMIT. */
const GLOBAL_LIMITER = 'global';

/**
 * With SAME_ORIGIN_ONLY set (the public deployment), a browser request from another site
 * is refused. Browsers always send `Origin` on a POST and on a WebSocket upgrade, and a
 * page cannot forge it, so another site cannot make its visitors' browsers create rooms
 * or open sockets here (which would also spread the per-address limit over their
 * addresses). Requests without `Origin` (not from a browser page) are let through; they
 * come from their own address and meet the per-address limits.
 */
function foreignOrigin(request: Request, env: Env): boolean {
  if (env.SAME_ORIGIN_ONLY !== 'true') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

async function createRoom(request: Request, env: Env, cors: boolean): Promise<Response> {
  const address = clientAddress(request);
  const { limit, windowMs } = parseCreateLimit(env.CREATE_LIMIT);
  const limiter = env.LIMITER.get(env.LIMITER.idFromName(`ip:${address}`));
  if (!(await limiter.allow(limit, windowMs))) {
    return json(
      { error: 'rate_limited', detail: 'too many rooms created; try again later' },
      429,
      cors,
    );
  }
  const global = parseCreateLimit(env.GLOBAL_CREATE_LIMIT, null);
  if (global !== null) {
    const all = env.LIMITER.get(env.LIMITER.idFromName(GLOBAL_LIMITER));
    if (!(await all.allow(global.limit, global.windowMs))) {
      return json(
        { error: 'rate_limited', detail: 'the server is full; try again later' },
        429,
        cors,
      );
    }
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateRoomCode(randomInt);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch('https://room/init', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    if (res.status === 201) {
      return json({ code, maxHumans: MAX_HUMANS, protocol: PROTOCOL_VERSION }, 201, cors);
    }
    if (res.status !== 409) return json({ error: 'internal_error' }, 500, cors);
  }
  return json({ error: 'internal_error', detail: 'no free room code' }, 503, cors);
}

export default {
  async fetch(request, env): Promise<Response> {
    const cors = env.SAME_ORIGIN_ONLY !== 'true';
    const { pathname } = new URL(request.url);
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors ? CORS : {} });
    }

    if (path === '/health' || path === '/rooms/health') {
      return json({ ok: true, service: 'rooms', protocol: PROTOCOL_VERSION }, 200, cors);
    }
    if (path === '/rooms') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
      if (foreignOrigin(request, env)) return json({ error: 'forbidden_origin' }, 403, cors);
      return createRoom(request, env, cors);
    }

    const match = /^\/rooms\/([^/]{1,32})(\/ws)?$/.exec(path);
    const code = match ? normalizeRoomCode(decodeURIComponent(match[1] ?? '')) : null;
    if (!match || code === null) return json({ error: 'not_found' }, 404, cors);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));

    if (match[2] === '/ws') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json({ error: 'expected a WebSocket upgrade' }, 426, cors);
      }
      if (foreignOrigin(request, env)) return json({ error: 'forbidden_origin' }, 403, cors);
      return stub.fetch(new Request('https://room/ws', request));
    }
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, cors);
    const res = await stub.fetch('https://room/info');
    return json(await res.json(), res.status, cors);
  },
} satisfies ExportedHandler<Env>;
