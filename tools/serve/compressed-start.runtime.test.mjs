// ./start.sh must serve the client compressed: it runs the same build as `npm run build` (which
// writes the .br/.gz siblings), and the server it starts (tools/serve/start.mjs) must answer an
// Accept-Encoding request for the page and for a script with Content-Encoding and Vary, on both
// the HTTP and the HTTPS listener.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './ports.mjs';
import { REPO_ROOT } from './rooms.mjs';

let child;
let ports;
let output = '';

function get(port, target, secure) {
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).get(
      {
        host: '127.0.0.1',
        port,
        path: target,
        rejectUnauthorized: false,
        headers: { 'accept-encoding': 'br, gzip' },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res));
      },
    );
    req.on('error', reject);
  });
}

beforeAll(async () => {
  // start.sh builds with the root build script, and that script precompresses.
  const startSh = fs.readFileSync(path.join(REPO_ROOT, 'start.sh'), 'utf8');
  const buildLines = startSh.split('\n').filter((l) => /^\s*npm run\b.*\bbuild\b/.test(l));
  expect(buildLines).toHaveLength(1);
  expect(buildLines[0]).not.toMatch(/-w\b|--workspace/);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts.build).toMatch(/tools\/serve\/precompress\.mjs/);

  // A small client, precompressed by the same step, served by the real start script.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compressed-start-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<!doctype html><title>t</title>${'<p>x</p>'.repeat(200)}`,
  );
  fs.writeFileSync(
    path.join(dir, 'assets/app.js'),
    `export const a = ${JSON.stringify('y'.repeat(5000))};\n`,
  );
  execFileSync(process.execPath, [path.join(REPO_ROOT, 'tools/serve/precompress.mjs'), dir]);
  // freePort hands out a port that is free now; another runtime starting beside this test can
  // take it before start.mjs binds it. That (and only that) starts again on fresh ports.
  for (let attempt = 1; ; attempt++) {
    ports = { PORT: await freePort(), HTTPS_PORT: await freePort(), ROOMS_PORT: await freePort() };
    output = '';
    child = spawn(process.execPath, [path.join(REPO_ROOT, 'tools/serve/start.mjs')], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLIENT_DIR: dir,
        ...Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, String(v)])),
      },
    });
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const deadline = Date.now() + 90_000;
    let taken = false;
    for (;;) {
      try {
        const res = await get(ports.PORT, '/', false);
        if (res.statusCode === 200) break;
      } catch {
        // not up yet
      }
      if (child.exitCode !== null) {
        if (/EADDRINUSE/.test(output) && attempt < 3) {
          taken = true;
          break;
        }
        throw new Error(`start.mjs exited:\n${output}`);
      }
      if (Date.now() > deadline) throw new Error(`start.mjs did not answer:\n${output}`);
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!taken) break;
  }
}, 120_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await Promise.race([done, new Promise((r) => setTimeout(r, 15_000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}, 30_000);

describe('the started server', () => {
  for (const secure of [false, true]) {
    for (const target of ['/', '/assets/app.js']) {
      it(`sends ${target} compressed over ${secure ? 'HTTPS' : 'HTTP'}`, async () => {
        const res = await get(secure ? ports.HTTPS_PORT : ports.PORT, target, secure);
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-encoding']).toBe('br');
        expect(res.headers.vary).toMatch(/accept-encoding/i);
      });
    }
  }
});
