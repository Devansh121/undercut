// Serves the built client over HTTP and HTTPS on all interfaces and runs the rooms
// service on the local Workers runtime behind same-origin /rooms. Started by
// ./start.sh after the build; also used by the browser tests.
//
//   node tools/serve/start.mjs               serve (ports from PORT, HTTPS_PORT, ROOMS_PORT)
//   node tools/serve/start.mjs --check-ports exit 0 if the ports are free, else explain
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { ensureCert } from './cert.mjs';
import { classifyInterfaces } from './network.mjs';
import { UsageError, assertPortsFree, portFromEnv } from './ports.mjs';
import { REPO_ROOT, StartCancelled, createRoomsService } from './rooms.mjs';
import { createHandlers } from './static.mjs';

// CLIENT_DIR overrides the built client folder (used by tests that need no build).
const CLIENT_DIR = path.resolve(process.env.CLIENT_DIR || path.join(REPO_ROOT, 'apps/web/dist'));

function readConfig() {
  const config = {
    port: portFromEnv('PORT', 5173),
    httpsPort: portFromEnv('HTTPS_PORT', 5174),
    roomsPort: portFromEnv('ROOMS_PORT', 8787),
  };
  return {
    ...config,
    checks: [
      { name: 'PORT', port: config.port, host: '0.0.0.0' },
      { name: 'HTTPS_PORT', port: config.httpsPort, host: '0.0.0.0' },
      { name: 'ROOMS_PORT', port: config.roomsPort, host: '127.0.0.1' },
    ],
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '0.0.0.0' }, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function printAddresses({ port, httpsPort }, { lan, other }) {
  const rows = [
    ['Local:', `http://localhost:${port}`],
    ['Local:', `https://localhost:${httpsPort}`],
  ];
  if (lan.length === 0)
    rows.push(['Wi-Fi:', 'no network found; connect to Wi-Fi to play from a phone']);
  for (const { address } of lan) {
    rows.push(['Wi-Fi:', `http://${address}:${port}`]);
    rows.push(['Wi-Fi:', `https://${address}:${httpsPort}`]);
  }
  for (const { name, address } of other) {
    rows.push(['Other:', `http://${address}:${port}  https://${address}:${httpsPort}  (${name})`]);
  }
  const lines = rows.map(([label, value]) => `  ${label.padEnd(7)} ${value}`);
  process.stdout.write(
    [
      '',
      'Ready. Open one of these:',
      ...lines,
      '',
      'A phone needs the Wi-Fi address. The HTTPS address shows a certificate warning',
      'once, because the certificate is self-signed on this machine. Press Ctrl-C to stop.',
      '',
    ].join('\n'),
  );
}

async function main() {
  const config = readConfig();
  await assertPortsFree(config.checks);
  if (process.argv.includes('--check-ports')) return;

  // Cleanup comes first: from here on, Ctrl-C at any moment stops whatever has started.
  const rooms = createRoomsService({ port: config.roomsPort });
  const servers = [];
  let handlers = null;
  let stopping = false;
  const shutdown = async (code) => {
    if (stopping) return;
    stopping = true;
    process.stdout.write('\nStopping ...\n');
    handlers?.destroyUpgraded();
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
    await rooms.stop();
    process.stdout.write('Stopped.\n');
    process.exit(code);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void shutdown(0));

  try {
    if (!fs.existsSync(path.join(CLIENT_DIR, 'index.html'))) {
      throw new UsageError(
        `No client build found in ${path.relative(REPO_ROOT, CLIENT_DIR) || CLIENT_DIR}. Run ./start.sh, or npm run build.`,
      );
    }

    const network = classifyInterfaces();
    const altNames = [
      'localhost',
      '127.0.0.1',
      ...network.lan.map((i) => i.address),
      ...network.other.map((i) => i.address),
    ];
    const tls = await ensureCert(path.join(REPO_ROOT, '.cache/certs'), altNames);
    if (tls.generated) {
      process.stdout.write(
        `Generated a self-signed certificate (${tls.generator}) in .cache/certs\n`,
      );
    }

    process.stdout.write(`Starting the rooms service on 127.0.0.1:${config.roomsPort} ...\n`);
    await rooms.start();
    rooms.exited.then(({ code }) => {
      if (!stopping) {
        process.stderr.write(`The rooms service stopped unexpectedly (exit code ${code}).\n`);
        void shutdown(1);
      }
    });

    handlers = createHandlers({
      root: CLIENT_DIR,
      roomsPort: config.roomsPort,
      networkOrigins: network.lan.flatMap((i) => [
        `http://${i.address}:${config.port}`,
        `https://${i.address}:${config.httpsPort}`,
      ]),
    });
    const httpServer = http.createServer(handlers.http);
    const httpsServer = https.createServer({ key: tls.key, cert: tls.cert }, handlers.https);
    for (const server of [httpServer, httpsServer]) {
      server.on('upgrade', handlers.upgrade);
      servers.push(server);
    }
    await listen(httpServer, config.port);
    await listen(httpsServer, config.httpsPort);
    if (stopping) return;
    printAddresses(config, network);
  } catch (error) {
    // A signal during startup cancels it; shutdown() is already cleaning up.
    if (stopping || error instanceof StartCancelled) return;
    process.stderr.write(`${error instanceof UsageError ? error.message : error.stack}\n`);
    await shutdown(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof UsageError ? error.message : error.stack}\n`);
  process.exit(1);
});
