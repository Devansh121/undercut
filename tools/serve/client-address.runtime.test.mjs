// The rooms service limits room creation and pending sockets per client address, read
// from cf-connecting-ip. Both local entry points (the static server behind ./start.sh
// and the Vite dev server) must set that header from the socket and never pass on a
// value the client sent: for plain requests and for WebSocket upgrades.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { freePort } from './ports.mjs';
import { REPO_ROOT } from './rooms.mjs';
import { createHandlers } from './static.mjs';

const SPOOF = '203.0.113.99';
const seen = [];
let upstream;
let upstreamPort;

beforeAll(async () => {
  upstreamPort = await freePort();
  upstream = http.createServer((req, res) => {
    seen.push({ kind: 'http', ip: req.headers['cf-connecting-ip'] });
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end('{"code":"BCDFGH"}');
  });
  upstream.on('upgrade', (req, socket) => {
    seen.push({ kind: 'ws', ip: req.headers['cf-connecting-ip'] });
    socket.destroy();
  });
  await new Promise((r) => upstream.listen(upstreamPort, '127.0.0.1', r));
});

afterAll(async () => {
  await new Promise((r) => upstream.close(r));
});

async function probe(port) {
  seen.length = 0;
  const res = await fetch(`http://127.0.0.1:${port}/rooms`, {
    method: 'POST',
    headers: { 'cf-connecting-ip': SPOOF },
  });
  expect(res.status).toBe(201);
  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/rooms/BCDFGH/ws`, {
      headers: { 'cf-connecting-ip': SPOOF },
    });
    ws.on('error', resolve);
    ws.on('close', resolve);
    ws.on('unexpected-response', resolve);
  });
  return [...seen];
}

const LOOPBACK = /^(::ffff:)?127\.0\.0\.1$|^::1$/;

describe('the client address reaching the rooms service', () => {
  it('is set from the socket by the static server (./start.sh)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-'));
    const handlers = createHandlers({ root, roomsPort: upstreamPort });
    const server = http.createServer(handlers.http);
    server.on('upgrade', handlers.upgrade);
    const port = await freePort();
    await new Promise((r) => server.listen(port, '127.0.0.1', r));
    try {
      const got = await probe(port);
      expect(got.map((g) => g.kind)).toEqual(['http', 'ws']);
      for (const g of got) expect(g.ip).toMatch(LOOPBACK);
    } finally {
      handlers.destroyUpgraded();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('is set from the socket by the Vite dev server (npm run dev)', async () => {
    const { createServer } = await import('vite');
    const previous = process.env.ROOMS_PORT;
    process.env.ROOMS_PORT = String(upstreamPort);
    const port = await freePort();
    const vite = await createServer({
      configFile: path.join(REPO_ROOT, 'apps/web/vite.config.ts'),
      root: path.join(REPO_ROOT, 'apps/web'),
      logLevel: 'silent',
      server: { port, host: '127.0.0.1', strictPort: true, hmr: false },
    });
    try {
      await vite.listen();
      const got = await probe(port);
      expect(got.map((g) => g.kind)).toEqual(['http', 'ws']);
      for (const g of got) expect(g.ip).toMatch(LOOPBACK);
    } finally {
      await vite.close();
      if (previous === undefined) delete process.env.ROOMS_PORT;
      else process.env.ROOMS_PORT = previous;
    }
  });
});
