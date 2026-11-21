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

/** Headers the proxy sets itself; a client's own values are dropped. */
const SET_BY_PROXY = new Set(['cf-connecting-ip', 'x-forwarded-for']);

/**
 * The encoding to send for an `Accept-Encoding` header: 'br', 'gzip' or null. Honours q=0
 * refusals; prefers Brotli.
 */
export function pickEncoding(header) {
  if (!header) return null;
  const accepted = new Map();
  for (const part of String(header).split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find((v) => v !== undefined);
    accepted.set(name, q === undefined ? 1 : Number(q));
  }
  const ok = (name) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

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

// Filesystem errors that mean "no such file here" or "not allowed", mapped to HTTP.
const STATUS_FOR_ERROR = {
  ENOENT: 404,
  ENOTDIR: 404,
  ENAMETOOLONG: 404,
  ELOOP: 404,
  EISDIR: 404,
  EINVAL: 400,
  EACCES: 403,
  EPERM: 403,
};

/**
 * Open `file` for reading. Returns `{ fd, stat }` for a regular file, `{ directory: true }`
 * for a directory, else `{ status, code }` with the HTTP status for the error. Never throws.
 */
function openFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    if (stat.isFile()) return { fd, stat };
    fs.closeSync(fd);
    return stat.isDirectory() ? { directory: true, status: 404 } : { status: 404 };
  } catch (error) {
    if (fd !== undefined) fs.close(fd, () => {});
    return { status: STATUS_FOR_ERROR[error?.code] ?? 500, code: error?.code };
  }
}

const STATUS_TEXT = { 400: 'Bad request', 403: 'Forbidden', 404: 'Not found', 500: 'Server error' };

function sendStatus(res, status) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(STATUS_TEXT[status] ?? 'Error');
}

/**
 * Request and upgrade handlers that serve the built client from `root` and pass
 * `/rooms` (HTTP and WebSocket) through to the rooms service on 127.0.0.1.
 */
export function createHandlers({ root, roomsPort, networkOrigins = [] }) {
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
          // What the Cloudflare edge sets; the rooms service keys its creation limit on it.
          // Overwrites anything the client sent.
          'cf-connecting-ip': req.socket.remoteAddress ?? '',
          'x-forwarded-proto': scheme,
          'x-forwarded-host': req.headers.host ?? '',
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.on('error', () => res.destroy());
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'rooms service unavailable' }));
    });
    req.on('error', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  };

  const serveFile = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const requested = resolveStaticPath(absRoot, req.url);
    if (requested === null) {
      sendStatus(res, 400);
      return;
    }
    let file = requested;
    let opened = openFile(file);
    if (opened.directory) {
      file = path.join(file, 'index.html');
      opened = openFile(file);
    }
    // A path that does not exist and has no extension is a client route: serve the
    // app shell. Other failures (a file used as a folder, a name too long) are errors.
    if (opened.code === 'ENOENT' && path.extname(requested) === '') {
      file = path.join(absRoot, 'index.html');
      opened = openFile(file);
    }
    if (opened.status !== undefined) {
      sendStatus(res, opened.status);
      return;
    }
    let { fd, stat } = opened;
    const hashed = file.startsWith(path.join(absRoot, 'assets') + path.sep);
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    // Precompressed sibling (tools/serve/precompress.mjs) when the client accepts it. The server
    // has no range support, so every response is the whole (possibly encoded) file.
    const encoding = pickEncoding(req.headers['accept-encoding']);
    let encoded = null;
    if (encoding) {
      const sibling = openFile(`${file}.${encoding === 'br' ? 'br' : 'gz'}`);
      if (sibling.fd !== undefined) {
        fs.close(fd, () => {});
        ({ fd, stat } = sibling);
        encoded = encoding;
      }
    }
    const compressible = encoded !== null || fs.existsSync(`${file}.gz`);
    res.writeHead(200, {
      'content-type': type,
      'content-length': stat.size,
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      ...(encoded ? { 'content-encoding': encoded } : {}),
      ...(compressible ? { vary: 'Accept-Encoding' } : {}),
    });
    if (req.method === 'HEAD') {
      fs.close(fd, () => {});
      res.end();
      return;
    }
    const stream = fs.createReadStream(null, { fd, autoClose: true });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };

  const request = (scheme) => (req, res) => {
    try {
      if (req.url === '/network-info') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ origins: networkOrigins }));
      } else if (isRoomsPath(req.url)) proxyHttp(req, res, scheme);
      else serveFile(req, res);
    } catch {
      // Last line of defence: no request may take the server down.
      if (res.headersSent) res.destroy();
      else sendStatus(res, 500);
    }
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
        // The client address comes from the socket, never from the client.
        if (SET_BY_PROXY.has(req.rawHeaders[i].toLowerCase())) continue;
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      const address = req.socket.remoteAddress ?? '';
      lines.push(`cf-connecting-ip: ${address}`, `x-forwarded-for: ${address}`);
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
