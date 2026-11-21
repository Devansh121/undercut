import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './ports.mjs';

const require = createRequire(import.meta.url);
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = path.join(REPO_ROOT, 'services/rooms/wrangler.jsonc');

/**
 * Start the rooms Worker on the local Workers runtime (`wrangler dev`), bound to
 * 127.0.0.1 only, with no login and no metrics. Resolves once /rooms/health answers.
 * The child runs in its own process group so `stop()` takes workerd down with it.
 *
 * @param {{ port: number, log?: (text: string) => void, quiet?: boolean }} options
 * @returns {Promise<{ url: string, port: number, pid: number | undefined,
 *   stop: () => Promise<void>, exited: Promise<{ code: number | null, signal: string | null }> }>}
 */
export async function startRooms({
  port,
  log = (text) => void process.stdout.write(text),
  quiet = false,
}) {
  const wrangler = require.resolve('wrangler/bin/wrangler.js', { paths: [REPO_ROOT] });
  const inspectorPort = await freePort();
  const child = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--config',
      CONFIG,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspectorPort),
      '--show-interactive-dev-session=false',
      '--log-level',
      quiet ? 'error' : 'warn',
    ],
    {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_HIDE_BANNER: 'true',
        NO_UPDATE_NOTIFIER: '1',
        FORCE_COLOR: '0',
      },
    },
  );

  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => `[rooms] ${line}\n`)
      .join('');
  child.stdout.on('data', (chunk) => log(prefix(chunk)));
  child.stderr.on('data', (chunk) => log(prefix(chunk)));

  let exited = false;
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });

  // Last resort if this process exits without calling stop(): take the group down too.
  const killOnExit = () => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  };
  process.once('exit', killOnExit);

  const stop = async () => {
    if (exited) return;
    const signalGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Group already gone.
      }
    };
    signalGroup('SIGTERM');
    const timer = setTimeout(() => signalGroup('SIGKILL'), 3000);
    await exitPromise;
    clearTimeout(timer);
    // workerd can outlive wrangler for a moment; make sure the group is gone.
    signalGroup('SIGKILL');
    process.off('exit', killOnExit);
  };

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) {
      const { code, signal } = await exitPromise;
      throw new Error(`rooms service exited during startup (code ${code}, signal ${signal})`);
    }
    try {
      const res = await fetch(`${url}/rooms/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { url, port, pid: child.pid, stop, exited: exitPromise };
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await stop();
  throw new Error('rooms service did not answer /rooms/health within 60 s');
}
