import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './ports.mjs';

const require = createRequire(import.meta.url);
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = path.join(REPO_ROOT, 'services/rooms/wrangler.jsonc');

/** Thrown by `start()` when `stop()` was called before the service became ready. */
export class StartCancelled extends Error {
  constructor() {
    super('rooms service start was cancelled');
    this.name = 'StartCancelled';
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

/** True while any process in group `pgid` exists. */
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function signalGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch {
    // Group already gone.
  }
}

/**
 * The rooms Worker on the local Workers runtime (`wrangler dev`), bound to 127.0.0.1
 * only, with no login and no metrics. Creating the handle does nothing; `start()`
 * spawns and resolves once /rooms/health answers. `stop()` may be called at any time,
 * including before or during `start()`: it cancels startup, kills wrangler's whole
 * process group (wrangler runs detached so workerd goes with it) and resolves only
 * once that group is gone. Install signal handlers that call `stop()` before `start()`.
 *
 * `vars` are passed to the Worker as environment variables (tests use them to shorten
 * room timings); the normal run passes none.
 *
 * @param {{ port: number, log?: (text: string) => void, quiet?: boolean, vars?: Record<string, string> }} options
 */
export function createRoomsService({
  port,
  log = (text) => void process.stdout.write(text),
  quiet = false,
  vars = {},
}) {
  const url = `http://127.0.0.1:${port}`;
  // Each instance keeps its Durable Object state (SQLite) in a directory of its own: the shared
  // default (.wrangler/state) let two runtimes started side by side (the test suite's service and
  // a test's own server) lock each other's databases (SQLITE_BUSY).
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'undercut-rooms-state-'));
  const cancel = new AbortController();
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  let childExited = false;
  let resolveExited;
  /** @type {Promise<{ code: number | null, signal: string | null }>} */
  const exited = new Promise((resolve) => (resolveExited = resolve));
  let stopPromise = null;

  // Last resort if this process exits without stop() finishing: kill the group too.
  const killOnExit = () => child && signalGroup(child.pid, 'SIGKILL');

  async function start() {
    if (cancel.signal.aborted) throw new StartCancelled();
    const inspectorPort = await freePort();
    if (cancel.signal.aborted) throw new StartCancelled();
    const wrangler = require.resolve('wrangler/bin/wrangler.js', { paths: [REPO_ROOT] });
    child = spawn(
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
        '--persist-to',
        persist,
        '--show-interactive-dev-session=false',
        '--log-level',
        quiet ? 'error' : 'warn',
        ...Object.entries(vars).flatMap(([key, value]) => ['--var', `${key}:${value}`]),
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
    process.once('exit', killOnExit);
    child.once('exit', (code, signal) => {
      childExited = true;
      resolveExited({ code, signal });
    });
    const prefix = (chunk) =>
      chunk
        .toString()
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => `[rooms] ${line}\n`)
        .join('');
    child.stdout.on('data', (chunk) => log(prefix(chunk)));
    child.stderr.on('data', (chunk) => log(prefix(chunk)));

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (cancel.signal.aborted) throw new StartCancelled();
      if (childExited) {
        const { code, signal } = await exited;
        throw new Error(`rooms service exited during startup (code ${code}, signal ${signal})`);
      }
      try {
        const res = await fetch(`${url}/rooms/health`, {
          signal: AbortSignal.any([AbortSignal.timeout(1000), cancel.signal]),
        });
        if (res.ok) return;
      } catch {
        // Not listening yet, or cancelled (checked at the top of the loop).
      }
      await sleep(250, cancel.signal);
    }
    if (cancel.signal.aborted) throw new StartCancelled();
    throw new Error('rooms service did not answer /rooms/health within 60 s');
  }

  async function doStop() {
    cancel.abort();
    if (!child) {
      fs.rmSync(persist, { recursive: true, force: true });
      return;
    }
    const pgid = child.pid;
    if (!childExited) {
      signalGroup(pgid, 'SIGTERM');
      const timer = setTimeout(() => signalGroup(pgid, 'SIGKILL'), 3000);
      await exited;
      clearTimeout(timer);
    }
    // workerd can outlive wrangler for a moment: kill what is left and wait until the
    // whole group has gone, so ports are free when this resolves.
    signalGroup(pgid, 'SIGKILL');
    const deadline = Date.now() + 5000;
    while (groupAlive(pgid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    process.off('exit', killOnExit);
    fs.rmSync(persist, { recursive: true, force: true });
  }

  return {
    url,
    port,
    start,
    /** Idempotent; safe to call before, during or after `start()`. */
    stop: () => (stopPromise ??= doStop()),
    /** Resolves when wrangler exits (never, if it was never spawned). */
    exited,
  };
}

/** Create and start in one step; stops again if startup fails. */
export async function startRooms(options) {
  const rooms = createRoomsService(options);
  try {
    await rooms.start();
  } catch (error) {
    await rooms.stop();
    throw error;
  }
  return rooms;
}
