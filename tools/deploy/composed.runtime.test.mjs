// Exercises the composed Cloudflare Worker (static client assets + same-origin /rooms
// Durable Objects) on the local Workers runtime via `wrangler dev --config wrangler.jsonc`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET } from '@undercut/protocol';
import { freePort } from '../serve/ports.mjs';
import { REPO_ROOT, stageAssets } from './stage.mjs';

const require = createRequire(import.meta.url);

function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch {
    // Group already exited.
  }
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Start the composed Worker on 127.0.0.1 with an isolated persistence directory and no
 * Cloudflare credentials.
 *
 * @param {Record<string, string>} [vars]
 */
async function startComposedWorker(vars = {}) {
  const port = await freePort();
  const inspectorPort = await freePort();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undercut-composed-worker-'));
  const url = `http://127.0.0.1:${port}`;
  const wrangler = require.resolve('wrangler/bin/wrangler.js', { paths: [REPO_ROOT] });

  const env = { ...process.env };
  for (const key of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_EMAIL',
    'CLOUDFLARE_API_KEY',
  ]) {
    delete env[key];
  }
  env.XDG_CONFIG_HOME = path.join(stateDir, '.config');
  env.WRANGLER_SEND_METRICS = 'false';
  env.WRANGLER_HIDE_BANNER = 'true';
  env.NO_UPDATE_NOTIFIER = '1';
  env.FORCE_COLOR = '0';

  const args = [
    wrangler,
    'dev',
    '--config',
    'wrangler.jsonc',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--inspector-port',
    String(inspectorPort),
    '--persist-to',
    path.join(stateDir, 'state'),
    '--show-interactive-dev-session=false',
    '--log-level',
    'warn',
    ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
  ];

  const logs = [];
  let exited = false;
  let resolveExit;
  const exitP = new Promise((r) => (resolveExit = r));
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  const killOnExit = () => signalGroup(child.pid, 'SIGKILL');
  process.once('exit', killOnExit);
  child.once('exit', (code, signal) => {
    exited = true;
    resolveExit({ code, signal });
  });
  const capture = (chunk) => logs.push(chunk.toString());
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  async function stop() {
    const pgid = child.pid;
    if (!exited) {
      signalGroup(pgid, 'SIGTERM');
      const timer = setTimeout(() => signalGroup(pgid, 'SIGKILL'), 3000);
      await exitP;
      clearTimeout(timer);
    }
    signalGroup(pgid, 'SIGKILL');
    const deadline = Date.now() + 5000;
    while (groupAlive(pgid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    process.off('exit', killOnExit);
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (exited) {
        const { code, signal } = await exitP;
        throw new Error(
          `Composed Worker exited during startup (code ${code}, signal ${signal}):\n${logs.join('')}`,
        );
      }
      try {
        const res = await fetch(`${url}/rooms/health`, { signal: AbortSignal.timeout(1000) });
        if (res.ok)
          return { url, wsUrl: url.replace(/^http/, 'ws'), stop, logs: () => logs.join('') };
      } catch {
        // Not listening yet.
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Composed Worker did not answer /rooms/health within 60 s:\n${logs.join('')}`);
  } catch (error) {
    await stop();
    throw error;
  }
}

describe('composed Cloudflare Worker (static client + /rooms)', () => {
  /** @type {Awaited<ReturnType<typeof startComposedWorker>>} */
  let worker;
  /** @type {WebSocket[]} */
  const openSockets = [];

  beforeAll(async () => {
    stageAssets();
    worker = await startComposedWorker();
  });

  afterEach(() => {
    for (const ws of openSockets.splice(0)) ws.terminate();
  });

  afterAll(async () => {
    if (worker) await worker.stop();
  });

  it('serves index.html at / with no-cache and client-compatible security headers', async () => {
    const res = await fetch(`${worker.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html\b/i);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const permissions = res.headers.get('permissions-policy') ?? '';
    expect(permissions).toContain('camera=()');
    expect(permissions).not.toContain('gamepad=');
    expect(permissions).not.toContain('fullscreen=');

    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval' blob:");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' blob: ws: wss:");
    expect(csp).toContain("frame-ancestors 'none'");

    const html = await res.text();
    expect(html).toContain('<div id="app">');
    expect(html).toMatch(/\.\/assets\/main-[^"]+\.js/);
  });

  it('serves hashed assets as immutable and unhashed runtime assets without immutable caching', async () => {
    const html = await (await fetch(`${worker.url}/`)).text();
    const jsMatch = /\.\/(assets\/main-[^"]+\.js)/.exec(html);
    const cssMatch = /\.\/(assets\/main-[^"]+\.css)/.exec(html);
    expect(jsMatch).not.toBeNull();
    expect(cssMatch).not.toBeNull();

    const jsRes = await fetch(`${worker.url}/${jsMatch[1]}`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toMatch(/javascript/i);
    expect(jsRes.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(jsRes.headers.get('x-content-type-options')).toBe('nosniff');

    const cssRes = await fetch(`${worker.url}/${cssMatch[1]}`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toMatch(/^text\/css\b/i);
    expect(cssRes.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const indexJsonRes = await fetch(`${worker.url}/assets/index.json`);
    expect(indexJsonRes.status).toBe(200);
    expect(indexJsonRes.headers.get('content-type')).toMatch(/^application\/json\b/i);
    expect(indexJsonRes.headers.get('cache-control')).toBe('no-cache');

    const wasmRes = await fetch(`${worker.url}/assets/draco/draco_decoder.wasm`);
    expect(wasmRes.status).toBe(200);
    expect(wasmRes.headers.get('content-type')).toMatch(/^application\/wasm\b/i);
    expect(wasmRes.headers.get('cache-control')).toBe('public, max-age=86400');

    const glbRes = await fetch(`${worker.url}/assets/car/car_high.glb`);
    expect(glbRes.status).toBe(200);
    expect(glbRes.headers.get('content-type')).toMatch(/^model\/gltf-binary\b/i);
    expect(glbRes.headers.get('cache-control')).toBe('public, max-age=86400');
  });

  it('returns 404 for missing assets instead of an HTML fallback', async () => {
    const missingAsset = await fetch(`${worker.url}/assets/does-not-exist.js`);
    expect(missingAsset.status).toBe(404);
    expect(missingAsset.headers.get('content-type')).not.toMatch(/^text\/html\b/i);

    const missingPath = await fetch(`${worker.url}/no-such-route`);
    expect(missingPath.status).toBe(404);
  });

  it('serves /rooms/health, creates a room and joins over a same-origin WebSocket', async () => {
    const health = await fetch(`${worker.url}/rooms/health`, {
      headers: { 'sec-fetch-mode': 'navigate' },
    });
    expect(health.status).toBe(200);
    expect(health.headers.get('cache-control')).toBe('no-store');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('access-control-allow-origin')).toBeNull();
    expect(await health.json()).toEqual({
      ok: true,
      service: 'rooms',
      protocol: PROTOCOL_VERSION,
    });

    const createRes = await fetch(`${worker.url}/rooms`, {
      method: 'POST',
      headers: { origin: worker.url, 'cf-connecting-ip': '203.0.113.1' },
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{6}$`));

    const infoRes = await fetch(`${worker.url}/rooms/${created.code}`);
    expect(infoRes.status).toBe(200);
    expect(await infoRes.json()).toEqual({
      code: created.code,
      phase: 'lobby',
      humans: 0,
      maxHumans: 8,
      joinable: true,
    });

    const ws = new WebSocket(`${worker.wsUrl}/rooms/${created.code}/ws`, {
      headers: { origin: worker.url },
    });
    openSockets.push(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const welcomeP = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no welcome within 5 s')), 5000);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') {
          clearTimeout(timer);
          resolve(msg);
        }
      });
    });
    ws.send(JSON.stringify({ type: 'join', v: PROTOCOL_VERSION, name: 'Ada' }));
    const welcome = await welcomeP;
    expect(welcome).toMatchObject({ type: 'welcome', you: 'm1', seat: 0 });
  });

  it('rejects cross-origin room creation and WebSocket upgrades', async () => {
    const badPost = await fetch(`${worker.url}/rooms`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'cf-connecting-ip': '203.0.113.2' },
    });
    expect(badPost.status).toBe(403);
    expect(await badPost.json()).toEqual({ error: 'forbidden_origin' });

    const okPost = await fetch(`${worker.url}/rooms`, {
      method: 'POST',
      headers: { origin: worker.url, 'cf-connecting-ip': '203.0.113.2' },
    });
    expect(okPost.status).toBe(201);
    const { code } = await okPost.json();

    const ws = new WebSocket(`${worker.wsUrl}/rooms/${code}/ws`, {
      headers: { origin: 'https://evil.example' },
    });
    openSockets.push(ws);
    const status = await new Promise((resolve, reject) => {
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.once('open', () => reject(new Error('cross-origin WebSocket should not have opened')));
      ws.once('error', reject);
    });
    expect(status).toBe(403);
  });

  it('enforces the production per-IP room creation limit (10 per 10 min)', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${worker.url}/rooms`, {
        method: 'POST',
        headers: { origin: worker.url, 'cf-connecting-ip': '203.0.113.10' },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);

    const otherIp = await fetch(`${worker.url}/rooms`, {
      method: 'POST',
      headers: { origin: worker.url, 'cf-connecting-ip': '203.0.113.11' },
    });
    expect(otherIp.status).toBe(201);
  });
});

describe('global room creation cap across distinct addresses', () => {
  /** @type {Awaited<ReturnType<typeof startComposedWorker>>} */
  let worker;

  beforeAll(async () => {
    stageAssets();
    worker = await startComposedWorker({ GLOBAL_CREATE_LIMIT: '3/60000' });
  });

  afterAll(async () => {
    if (worker) await worker.stop();
  });

  it('rejects room creation once GLOBAL_CREATE_LIMIT is reached even from new IPs', async () => {
    const statuses = [];
    for (let i = 1; i <= 4; i++) {
      const res = await fetch(`${worker.url}/rooms`, {
        method: 'POST',
        headers: { origin: worker.url, 'cf-connecting-ip': `198.51.100.${i}` },
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([201, 201, 201, 429]);
  });
});
