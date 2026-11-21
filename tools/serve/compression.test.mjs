// Compressed delivery: the build writes .br and .gz beside each compressible file, and the static
// server sends the best encoding the client accepts, with the original's type and the right
// headers. Binaries that do not shrink (WebP, PNG, GLB) are sent as they are.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { precompress } from './precompress.mjs';
import { createHandlers } from './static.mjs';

let root;
let server;
let port;
const js = `export const value = ${JSON.stringify('x'.repeat(4000))};\n`.repeat(4);
const webp = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7919) % 251));

function get(target, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compress-'));
  fs.mkdirSync(path.join(root, 'assets/tex'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), `<title>shell</title>${' '.repeat(2000)}`);
  fs.writeFileSync(path.join(root, 'assets/app.js'), js);
  fs.writeFileSync(path.join(root, 'assets/tex/a.webp'), webp);
  fs.writeFileSync(path.join(root, 'assets/tiny.json'), '{}');
  precompress(root);
  server = http.createServer(createHandlers({ root, roomsPort: 1 }).http);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

describe('precompress', () => {
  it('writes .br and .gz for text that shrinks, nothing for binaries or tiny files', () => {
    expect(fs.existsSync(path.join(root, 'assets/app.js.br'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'assets/app.js.gz'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'index.html.br'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'assets/tex/a.webp.br'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'assets/tiny.json.br'))).toBe(false);
    expect(
      zlib.brotliDecompressSync(fs.readFileSync(path.join(root, 'assets/app.js.br'))).toString(),
    ).toBe(js);
  });
});

describe('compressed delivery', () => {
  it('sends brotli when accepted, with the original type, Vary and the compressed length', async () => {
    const r = await get('/assets/app.js', { 'accept-encoding': 'gzip, deflate, br' });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('br');
    expect(r.headers['content-type']).toMatch(/^text\/javascript/);
    expect(r.headers.vary).toMatch(/accept-encoding/i);
    expect(Number(r.headers['content-length'])).toBe(r.body.length);
    expect(r.body.length).toBeLessThan(js.length / 4);
    expect(zlib.brotliDecompressSync(r.body).toString()).toBe(js);
  });

  it('falls back to gzip, then to the raw file', async () => {
    const gz = await get('/assets/app.js', { 'accept-encoding': 'gzip' });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gz.body).toString()).toBe(js);
    const raw = await get('/assets/app.js');
    expect(raw.headers['content-encoding']).toBeUndefined();
    expect(raw.body.toString()).toBe(js);
    const refused = await get('/assets/app.js', { 'accept-encoding': 'br;q=0, gzip;q=0' });
    expect(refused.headers['content-encoding']).toBeUndefined();
  });

  it('serves the app shell compressed, and binaries as they are', async () => {
    const shell = await get('/', { 'accept-encoding': 'br' });
    expect(shell.headers['content-encoding']).toBe('br');
    expect(shell.headers['content-type']).toMatch(/^text\/html/);
    const img = await get('/assets/tex/a.webp', { 'accept-encoding': 'br, gzip' });
    expect(img.headers['content-encoding']).toBeUndefined();
    expect(img.headers['content-type']).toBe('image/webp');
    expect(img.body.equals(webp)).toBe(true);
  });

  it('answers HEAD with the encoded length and no body', async () => {
    const r = await get('/assets/app.js', { 'accept-encoding': 'br' }, 'HEAD');
    expect(r.headers['content-encoding']).toBe('br');
    expect(Number(r.headers['content-length'])).toBe(
      fs.statSync(path.join(root, 'assets/app.js.br')).size,
    );
    expect(r.body.length).toBe(0);
  });
});
