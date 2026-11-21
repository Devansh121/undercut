// `npm run dev`: the rooms service on the local Workers runtime plus the Vite dev
// server with hot reload on all interfaces. Vite proxies same-origin /rooms (HTTP and
// WebSocket) to the rooms service, the same shape as ./start.sh.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { UsageError, assertPortsFree, portFromEnv } from './ports.mjs';
import { REPO_ROOT, startRooms } from './rooms.mjs';

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

  process.stdout.write(`Starting the rooms service on 127.0.0.1:${roomsPort} ...\n`);
  const rooms = await startRooms({ port: roomsPort });

  const vite = spawn(
    process.execPath,
    [viteBin, '--host', '0.0.0.0', '--port', String(port), '--strictPort'],
    {
      cwd: path.join(REPO_ROOT, 'apps/web'),
      stdio: 'inherit',
      env: { ...process.env, ROOMS_PORT: String(roomsPort) },
    },
  );

  let stopping = false;
  const shutdown = async (code) => {
    if (stopping) return;
    stopping = true;
    if (vite.exitCode === null) vite.kill('SIGTERM');
    await rooms.stop();
    process.exit(code);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void shutdown(0));
  vite.once('exit', (code) => void shutdown(code ?? 0));
  rooms.exited.then(({ code }) => {
    if (!stopping) {
      process.stderr.write(`The rooms service stopped unexpectedly (exit code ${code}).\n`);
      void shutdown(1);
    }
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof UsageError ? error.message : error.stack}\n`);
  process.exit(1);
});
