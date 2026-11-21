// Ctrl-C during startup must leave nothing behind. Runs the real start and dev
// scripts, interrupts them while the rooms service is still starting, and checks
// for leftover wrangler/workerd processes and busy ports. Linux only (reads /proc).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { freePort, isPortFree } from './ports.mjs';
import { REPO_ROOT } from './rooms.mjs';

const linux = process.platform === 'linux';
const usedRoomsPorts = [];

/** PIDs of processes (other than us) whose command line mentions the rooms port. */
function processesForRoomsPort(port) {
  const needles = [`--port\0${port}\0`, `127.0.0.1:${port}`];
  const found = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    let cmdline;
    try {
      cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'latin1');
      // Zombies have an empty command line and hold no sockets.
      if (cmdline === '') continue;
    } catch {
      continue;
    }
    if (needles.some((n) => cmdline.includes(n))) found.push(Number(entry));
  }
  return found;
}

async function waitFor(predicate, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function interruptDuringStartup(script, when) {
  const ports = {
    PORT: await freePort(),
    HTTPS_PORT: await freePort(),
    ROOMS_PORT: await freePort(),
  };
  usedRoomsPorts.push(ports.ROOMS_PORT);
  const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-'));
  fs.writeFileSync(path.join(clientDir, 'index.html'), '<title>t</title>');
  const child = spawn(process.execPath, [path.join(REPO_ROOT, script)], {
    cwd: REPO_ROOT,
    detached: true, // its own process group, like a shell job
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CLIENT_DIR: clientDir,
      ...Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, String(v)])),
    },
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );

  try {
    await waitFor(
      () => output.includes('Starting the rooms service'),
      30_000,
      'the startup message',
    );
    if (when === 'wrangler-running') {
      await waitFor(
        () => processesForRoomsPort(ports.ROOMS_PORT).length > 0,
        30_000,
        'wrangler to start',
      );
    }
    // Still starting: the service has not reported ready.
    expect(output).not.toMatch(/Ready|VITE v/);
    process.kill(-child.pid, 'SIGINT'); // what Ctrl-C does to a foreground job
    const result = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 20_000)),
    ]);
    expect(result, output).not.toBe('timeout');

    const left = processesForRoomsPort(ports.ROOMS_PORT);
    expect(left, `processes left behind:\n${output}`).toEqual([]);
    for (const [name, port] of Object.entries(ports)) {
      const host = name === 'ROOMS_PORT' ? '127.0.0.1' : '0.0.0.0';
      expect(await isPortFree(port, host), `${name} ${port} still bound`).toBe(true);
    }
    return { output, result };
  } finally {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    fs.rmSync(clientDir, { recursive: true, force: true });
  }
}

afterEach(async () => {
  // Never leave a failed run's processes on the machine: give late children a moment
  // to appear, then kill every process group that still serves a port we used.
  await new Promise((r) => setTimeout(r, 500));
  for (const port of usedRoomsPorts.splice(0)) {
    for (const pid of processesForRoomsPort(port)) {
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'latin1');
        const pgid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
        process.kill(-pgid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
});

describe.skipIf(!linux)('Ctrl-C during startup leaves nothing running', () => {
  it('start.mjs, interrupted before wrangler is spawned', async () => {
    await interruptDuringStartup('tools/serve/start.mjs', 'announced');
  });

  it('start.mjs, interrupted while wrangler is starting', async () => {
    const { output } = await interruptDuringStartup('tools/serve/start.mjs', 'wrangler-running');
    expect(output).toContain('Stopped.');
  });

  it('dev.mjs, interrupted while wrangler is starting', async () => {
    await interruptDuringStartup('tools/serve/dev.mjs', 'wrangler-running');
  });
});
