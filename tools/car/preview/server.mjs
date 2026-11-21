// Tiny static server for the car preview. Serves only what the viewer needs from the repository.
// Not part of the app build. Usage: node tools/car/preview/server.mjs [port]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ALLOWED = [
  'tools/car/preview/',
  'node_modules/three/',
  'apps/web/public/assets/car/',
  'design/mock/fonts/',
  'design/teams.json',
];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '') rel = 'tools/car/preview/index.html';
    const full = path.resolve(root, rel);
    const inside = full.startsWith(root + path.sep);
    if (!inside || !ALLOWED.some((a) => rel === a || rel.startsWith(a)) || !fs.existsSync(full)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(full)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer(Number(process.argv[2] ?? 0));
  console.log(`Car preview on http://127.0.0.1:${server.address().port}/ (pid ${process.pid})`);
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
