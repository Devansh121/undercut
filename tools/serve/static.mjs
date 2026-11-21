import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.exr': 'image/x-exr',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** True for `/rooms` and anything under `/rooms/`. */
export function isRoomsPath(url) {
  const pathname = (url ?? '/').split('?')[0];
  return pathname === '/rooms' || pathname.startsWith('/rooms/');
}

/**
 * Map a request path to a file inside `root`, or null if it escapes `root` or is
 * malformed. Directories map to their index.html.
 */
export function resolveStaticPath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent((urlPath ?? '/').split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return decoded.endsWith('/') ? path.join(target, 'index.html') : target;
}

/**
 * Request and upgrade handlers that serve the built client from `root` and pass
 * `/rooms` (HTTP and WebSocket) through to the rooms service on 127.0.0.1.
 */
export function createHandlers({ root, roomsPort }) {
  const absRoot = path.resolve(root);
  const sockets = new Set();

  const proxyHttp = (req, res, scheme) => {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: roomsPort,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          'x-forwarded-for': req.socket.remoteAddress ?? '',
          'x-forwarded-proto': scheme,
          'x-forwarded-host': req.headers.host ?? '',
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'rooms service unavailable' }));
    });
    req.pipe(upstream);
  };

  const serveFile = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    let file = resolveStaticPath(absRoot, req.url);
    if (file === null) {
      res.writeHead(400).end();
      return;
    }
    let stat = fs.statSync(file, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = fs.statSync(file, { throwIfNoEntry: false });
    }
    // Unknown paths without an extension are client routes: serve the app shell.
    if (!stat && path.extname(file) === '') {
      file = path.join(absRoot, 'index.html');
      stat = fs.statSync(file, { throwIfNoEntry: false });
    }
    if (!stat?.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const hashed = file.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  };

  const request = (scheme) => (req, res) => {
    if (isRoomsPath(req.url)) proxyHttp(req, res, scheme);
    else serveFile(req, res);
  };

  const upgrade = (req, socket, head) => {
    if (!isRoomsPath(req.url)) {
      socket.destroy();
      return;
    }
    const upstream = net.connect(roomsPort, '127.0.0.1');
    sockets.add(socket).add(upstream);
    const cleanup = () => {
      socket.destroy();
      upstream.destroy();
      sockets.delete(socket);
      sockets.delete(upstream);
    };
    upstream.once('connect', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', cleanup);
    socket.on('error', cleanup);
    upstream.on('close', cleanup);
    socket.on('close', cleanup);
  };

  const destroyUpgraded = () => {
    for (const s of sockets) s.destroy();
    sockets.clear();
  };

  return { http: request('http'), https: request('https'), upgrade, destroyUpgraded };
}
