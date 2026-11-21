// `npm run dev`: the rooms service on the local Workers runtime plus the Vite dev
// server with hot reload on all interfaces. Vite proxies same-origin /rooms (HTTP and
// WebSocket) to the rooms service, the same shape as ./start.sh.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { UsageError, assertPortsFree, portFromEnv } from './ports.mjs';
import { REPO_ROOT, StartCancelled, createRoomsService } from './rooms.mjs';

const require = createRequire(import.meta.url);

async function main() {
  const port = portFromEnv('PORT', 5173);
  const roomsPort = portFromEnv('ROOMS_PORT', 8787);
  await assertPortsFree([
    { name: 'PORT', port, host: '0.0.0.0' },
    { name: 'ROOMS_PORT', port: roomsPort, host: '127.0.0.1' },
  ]);

  // vite's package exports do not include its bin, so resolve it via package.json.
  const vitePkg = require.resolve('vite/package.json', {
    paths: [path.join(REPO_ROOT, 'apps/web')],
  });
  const viteBin = path.join(path.dirname(vitePkg), require(vitePkg).bin.vite);

  // Cleanup comes first: from here on, Ctrl-C at any moment stops whatever has started.
  const rooms = createRoomsService({ port: roomsPort });
  let vite = null;
  let stopping = false;
  const stopVite = async () => {
    if (!vite || vite.exitCode !== null || vite.signalCode !== null) return;
    const gone = new Promise((resolve) => vite.once('exit', resolve));
    vite.kill('SIGTERM');
    const timer = setTimeout(() => vite.kill('SIGKILL'), 3000);
    await gone;
    clearTimeout(timer);
  };
  const shutdown = async (code) => {
    if (stopping) return;
    stopping = true;
    await Promise.all([stopVite(), rooms.stop()]);
    process.exit(code);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void shutdown(0));

  process.stdout.write(`Starting the rooms service on 127.0.0.1:${roomsPort} ...\n`);
  try {
    await rooms.start();
  } catch (error) {
    // A signal during startup cancels it; shutdown() is already cleaning up.
    if (stopping || error instanceof StartCancelled) return;
    process.stderr.write(`${error.stack}\n`);
    await shutdown(1);
    return;
  }
  rooms.exited.then(({ code }) => {
    if (!stopping) {
      process.stderr.write(`The rooms service stopped unexpectedly (exit code ${code}).\n`);
      void shutdown(1);
    }
  });

  vite = spawn(
    process.execPath,
    [viteBin, '--host', '0.0.0.0', '--port', String(port), '--strictPort'],
    {
      cwd: path.join(REPO_ROOT, 'apps/web'),
      stdio: 'inherit',
      env: { ...process.env, ROOMS_PORT: String(roomsPort) },
    },
  );
  vite.once('exit', (code) => void shutdown(code ?? 0));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof UsageError ? error.message : error.stack}\n`);
  process.exit(1);
});
