// The static server must answer every request path with an HTTP status: none may
// crash the process or read outside the root.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandlers } from './static.mjs';

let root;
let outside;
let server;
let port;

/** Send a raw request line so the path reaches the server exactly as written. */
function rawGet(target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('latin1');
    socket.on('data', (chunk) => (data += chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0);
      resolve({ status, body: data.slice(data.indexOf('\r\n\r\n') + 4) });
    });
    socket.write(`GET ${target} HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n`);
  });
}

beforeAll(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'static-'));
  root = path.join(base, 'dist');
  outside = path.join(base, 'secret.txt');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<title>shell</title>');
  fs.writeFileSync(path.join(root, 'assets/app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(root, 'assets/locked.js'), 'locked');
  fs.chmodSync(path.join(root, 'assets/locked.js'), 0o000);
  fs.writeFileSync(outside, 'TOP-SECRET');
  // roomsPort 1: nothing listens there; only static paths are exercised here.
  const handlers = createHandlers({ root, roomsPort: 1 });
  server = http.createServer(handlers.http);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.chmodSync(path.join(root, 'assets/locked.js'), 0o644);
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe('static server', () => {
  it('serves files and the app shell', async () => {
    expect(await rawGet('/')).toMatchObject({ status: 200, body: '<title>shell</title>' });
    expect(await rawGet('/assets/app.js')).toMatchObject({ status: 200, body: 'console.log(1)' });
    expect((await rawGet('/assets/missing.js')).status).toBe(404);
  });

  const hostile = [
    ['a file used as a directory', '/index.html/extra'],
    ['a file used as a deeper directory', '/assets/app.js/x/y'],
    ['a 256-character component', `/${'a'.repeat(256)}`],
    ['a 256-character file name', `/${'a'.repeat(256)}.js`],
    ['a 5000-character component', `/assets/${'b'.repeat(5000)}`],
    ['an unreadable file', '/assets/locked.js'],
    ['an encoded NUL', '/%00'],
    ['an encoded NUL inside a name', '/a%00b.js'],
    ['truncated percent-encoding', '/%E0%A4%A'],
    ['a lone percent sign', '/%'],
    ['a parent reference', '/../secret.txt'],
    ['many parent references', '/../../../../etc/passwd'],
    ['encoded dots', '/%2e%2e/secret.txt'],
    ['encoded dots and slash', '/%2e%2e%2fsecret.txt'],
    ['encoded slashes', '/..%2f..%2fsecret.txt'],
    ['encoded slashes below a folder', '/assets/..%2f..%2fsecret.txt'],
    ['a backslash', '/..\\secret.txt'],
    ['encoded backslashes', '/%5c..%5csecret.txt'],
    ['a double slash', '//secret.txt'],
    ['a dot then parent', '/./../secret.txt'],
    ['an absolute-form target', 'http://evil.test/../secret.txt'],
  ];

  it.each(hostile)('answers %s with an HTTP status and keeps serving', async (_label, target) => {
    const res = await rawGet(target);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
    expect(res.body).not.toContain('TOP-SECRET');
    expect(res.body).not.toMatch(/root:.*:0:0:/);
    // The server is still up and still right.
    expect(await rawGet('/assets/app.js')).toMatchObject({ status: 200, body: 'console.log(1)' });
  });

  it('answers a path that names a file as a directory with 404', async () => {
    expect((await rawGet('/index.html/extra')).status).toBe(404);
  });

  it('answers an over-long path component with 404', async () => {
    expect((await rawGet(`/${'a'.repeat(256)}.js`)).status).toBe(404);
  });

  it('answers an unreadable file with 403', async () => {
    // Root can read anything, so this check only means something for other users.
    if (process.getuid?.() === 0) return;
    expect((await rawGet('/assets/locked.js')).status).toBe(403);
  });
});
