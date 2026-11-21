import { afterEach, describe, expect, inject, it } from 'vitest';
import WebSocket from 'ws';
import { MAX_MESSAGE_LENGTH, PROTOCOL_VERSION, type ServerMessage } from '@undercut/protocol';

const base = inject('roomsUrl');
const wsBase = base.replace(/^http/, 'ws');
const open: WebSocket[] = [];

afterEach(() => {
  for (const ws of open.splice(0)) ws.terminate();
});

/** A client that queues every server message so tests can await them in order. */
async function connect(roomId: string) {
  const ws = new WebSocket(`${wsBase}/rooms/${roomId}`);
  open.push(ws);
  const queue: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return {
    ws,
    send: (value: unknown) => ws.send(typeof value === 'string' ? value : JSON.stringify(value)),
    next: (): Promise<ServerMessage> => {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no message within 5 s')), 5000);
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      });
    },
  };
}

const hello = (name: string) => ({ type: 'hello', v: PROTOCOL_VERSION, name });
let roomCounter = 0;
const freshRoom = () => `t${Date.now().toString(36)}${(roomCounter++).toString(36)}`;

describe('rooms service on the local Workers runtime', () => {
  it('answers /rooms/health', async () => {
    const res = await fetch(`${base}/rooms/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'rooms', protocol: PROTOCOL_VERSION });
  });

  it('returns 404 for an invalid room id and 426 without an upgrade', async () => {
    expect((await fetch(`${base}/rooms/bad%20id`)).status).toBe(404);
    expect((await fetch(`${base}/rooms/${freshRoom()}`)).status).toBe(426);
  });

  it('broadcasts presence to everyone in the room as peers say hello and leave', async () => {
    const room = freshRoom();
    const a = await connect(room);
    a.send(hello('Ana'));
    const first = await a.next();
    expect(first).toMatchObject({ type: 'presence', peers: [{ name: 'Ana' }] });
    const aId = first.type === 'presence' ? first.you : '';

    const b = await connect(room);
    b.send(hello('Ben'));
    const [toA, toB] = await Promise.all([a.next(), b.next()]);
    for (const message of [toA, toB]) {
      expect(message.type).toBe('presence');
      if (message.type === 'presence') {
        expect(message.peers.map((p) => p.name).sort()).toEqual(['Ana', 'Ben']);
      }
    }
    expect(toA).toMatchObject({ you: aId });
    expect(toB.type === 'presence' && toB.you).not.toBe(aId);

    b.ws.close(1000, 'bye');
    expect(await a.next()).toMatchObject({
      type: 'presence',
      you: aId,
      peers: [{ id: aId, name: 'Ana' }],
    });
  });

  it('keeps rooms separate', async () => {
    const a = await connect(freshRoom());
    const b = await connect(freshRoom());
    a.send(hello('Ana'));
    b.send(hello('Ben'));
    expect(await a.next()).toMatchObject({ peers: [{ name: 'Ana' }] });
    expect(await b.next()).toMatchObject({ peers: [{ name: 'Ben' }] });
  });

  it('rejects invalid messages with the protocol error code and keeps the socket open', async () => {
    const c = await connect(freshRoom());
    c.send('{not json');
    expect(await c.next()).toMatchObject({ type: 'error', code: 'bad_json' });
    c.send({ type: 'hello', v: PROTOCOL_VERSION + 1, name: 'Old' });
    expect(await c.next()).toMatchObject({ type: 'error', code: 'version_mismatch' });
    c.send({ type: 'hello', v: PROTOCOL_VERSION, name: '' });
    expect(await c.next()).toMatchObject({ type: 'error', code: 'bad_message' });
    c.send({ type: 'warp' });
    expect(await c.next()).toMatchObject({ type: 'error', code: 'unknown_type' });
    c.send('x'.repeat(MAX_MESSAGE_LENGTH + 1));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'too_large' });
    c.ws.send(Buffer.from([1, 2, 3]));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'bad_message' });

    for (const raw of [
      '{"type":{"toString":null}}',
      '{"type":{"type":"hello"}}',
      '{"type":["hello"]}',
      '{"type":null}',
      JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: { toString: null } }),
      JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, name: ['Cy'] }),
      JSON.stringify({ type: 'hello', v: [PROTOCOL_VERSION], name: 'Cy' }),
    ]) {
      c.send(raw);
      expect(await c.next()).toMatchObject({ type: 'error', code: 'bad_message' });
    }

    c.send(hello('Cy'));
    expect(await c.next()).toMatchObject({ type: 'presence', peers: [{ name: 'Cy' }] });
  });

  it('does not list a peer who never said hello', async () => {
    const room = freshRoom();
    const silent = await connect(room);
    const d = await connect(room);
    d.send(hello('Dee'));
    expect(await d.next()).toMatchObject({ peers: [{ name: 'Dee' }] });
    silent.ws.close();
  });
});
