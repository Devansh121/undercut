import { afterAll, afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  CLOSE,
  LIMITS,
  MAX_MESSAGE_LENGTH,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  type ServerMessage,
} from '@undercut/protocol';
import { base, createRoom, roomsUrl, serviceErrors } from './headless';

const wsBase = base.replace(/^http/, 'ws');
const open: WebSocket[] = [];

afterEach(() => {
  for (const ws of open.splice(0)) ws.terminate();
});

afterAll(() => {
  expect(serviceErrors()).toEqual([]);
});

/** A raw socket that queues every server message so tests can await them in order. */
async function connect(code: string) {
  const ws = new WebSocket(`${wsBase}/rooms/${code}/ws`);
  open.push(ws);
  const queue: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  let closed: { code: number; reason: string } | null = null;
  const closedP = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once('close', (code, reason) => {
      closed = { code, reason: reason.toString() };
      resolve(closed);
    }),
  );
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const message = JSON.parse(data.toString()) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const next = (type?: ServerMessage['type']): Promise<ServerMessage> =>
    new Promise((resolve, reject) => {
      const take = (m: ServerMessage) => {
        if (type && m.type !== type) return void waiters.unshift(take);
        clearTimeout(timer);
        resolve(m);
      };
      const timer = setTimeout(() => reject(new Error(`no ${type ?? 'message'} within 5 s`)), 5000);
      while (queue.length > 0) {
        const m = queue.shift() as ServerMessage;
        if (!type || m.type === type) {
          clearTimeout(timer);
          resolve(m);
          return;
        }
      }
      waiters.push(take);
    });
  return {
    ws,
    send: (value: unknown) => ws.send(typeof value === 'string' ? value : JSON.stringify(value)),
    next,
    closed: () => closed,
    whenClosed: closedP,
  };
}

const join = (name: string) => ({ type: 'join', v: PROTOCOL_VERSION, name });

describe('HTTP endpoints', () => {
  it('answers /rooms/health', async () => {
    const res = await fetch(`${roomsUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'rooms', protocol: PROTOCOL_VERSION });
  });

  it('creates a room with a short code and reports it joinable, by any spelling', async () => {
    const code = await createRoom();
    expect(code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{6}$`));
    for (const spelling of [code, code.toLowerCase(), `${code.slice(0, 3)}-${code.slice(3)}`]) {
      const res = await fetch(`${roomsUrl}/${spelling}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        code,
        phase: 'lobby',
        humans: 0,
        maxHumans: 8,
        joinable: true,
      });
    }
  });

  it('returns 404 for codes that do not exist or cannot exist, and 405 and 426 where due', async () => {
    expect((await fetch(`${roomsUrl}/BBBBBB`)).status).toBe(404);
    expect((await fetch(`${roomsUrl}/bad%20id`)).status).toBe(404);
    expect((await fetch(`${roomsUrl}/AEIOU1`)).status).toBe(404);
    expect((await fetch(roomsUrl)).status).toBe(405);
    const code = await createRoom();
    expect((await fetch(`${roomsUrl}/${code}/ws`)).status).toBe(426);
    const ws = new WebSocket(`${wsBase}/rooms/BBBBBB/ws`);
    const status = await new Promise((resolve) =>
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode)),
    );
    expect(status).toBe(404);
  });

  it('limits room creation per client address', async () => {
    const address = `limit-${Date.now()}`;
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await fetch(roomsUrl, {
        method: 'POST',
        headers: { 'cf-connecting-ip': address },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect(
      (await fetch(roomsUrl, { method: 'POST', headers: { 'cf-connecting-ip': `${address}-b` } }))
        .status,
    ).toBe(201);
  });
});

describe('the room socket refuses bad input and stays open', () => {
  it('answers each invalid message with its error code', async () => {
    const code = await createRoom();
    const c = await connect(code);
    c.send({ type: 'ready', ready: true });
    expect(await c.next()).toMatchObject({ type: 'error', code: 'not_joined' });
    c.send('{not json');
    expect(await c.next()).toMatchObject({ type: 'error', code: 'bad_json' });
    c.send(join('Cy'));
    expect(await c.next('welcome')).toMatchObject({ type: 'welcome', you: 'm1', seat: 0 });

    const cases: [unknown, string][] = [
      [{ type: 'warp' }, 'unknown_type'],
      ['x'.repeat(MAX_MESSAGE_LENGTH + 1), 'too_large'],
      ['{"type":{"toString":null}}', 'bad_message'],
      ['{"type":["ready"]}', 'bad_message'],
      [{ type: 'ready', ready: { valueOf: null } }, 'bad_message'],

      [{ type: 'lap', seat: 0 }, 'bad_message'],
    ];
    for (const [raw, expected] of cases) {
      c.send(raw);
      expect(await c.next('error')).toMatchObject({ code: expected });
    }
    c.ws.send(Buffer.from([1, 2, 3]));
    expect(await c.next('error')).toMatchObject({ code: 'bad_message' });
    // Nine strikes so far: one more would close the socket. A valid message in the
    // wrong phase is refused without a strike.
    c.send({ type: 'rematch' });
    expect(await c.next('error')).toMatchObject({ code: 'wrong_phase' });
    c.send({ type: 'ping', id: 1, t: 5 });
    expect(await c.next('pong')).toMatchObject({ id: 1, t: 5 });
    expect(c.closed()).toBeNull();
  });

  it('closes a socket after too many strikes', async () => {
    const code = await createRoom();
    const c = await connect(code);
    c.send(join('Dee'));
    await c.next('welcome');
    for (let i = 0; i < LIMITS.maxStrikes; i++) c.send('{bad');
    expect((await c.whenClosed).code).toBe(CLOSE.tooManyStrikes);
  });

  it('rate-limits a flood of control messages', async () => {
    const code = await createRoom();
    const c = await connect(code);
    c.send(join('Eve'));
    await c.next('welcome');
    for (let i = 0; i < 40; i++) c.send({ type: 'ready', ready: i % 2 === 0 });
    expect(await c.next('error')).toMatchObject({ code: 'rate_limited' });
  });

  it('refuses a version it does not speak and closes', async () => {
    const code = await createRoom();
    const c = await connect(code);
    c.send({ type: 'join', v: 1, name: 'Old' });
    expect(await c.next('error')).toMatchObject({ code: 'version_mismatch' });
    expect((await c.whenClosed).code).toBe(CLOSE.versionMismatch);
  });
});
