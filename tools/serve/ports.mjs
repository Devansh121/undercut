import net from 'node:net';

/** Read a port from the environment, with a default; exits with a clear message if invalid. */
export function portFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError(`${name}=${raw} is not a valid port (1 to 65535).`);
  }
  return port;
}

export class UsageError extends Error {}

/** Resolve true if `port` can be bound on `host` right now. */
export function isPortFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/**
 * Ask the OS for a free port on `host`.
 * @returns {Promise<number>}
 */
export function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port: 0, host }, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Check every `{ name, port, host }` is free; throws a UsageError naming each one in use.
 */
export async function assertPortsFree(ports) {
  const seen = new Map();
  for (const { name, port } of ports) {
    if (seen.has(port)) {
      throw new UsageError(
        `${name} and ${seen.get(port)} are both ${port}; give them different ports.`,
      );
    }
    seen.set(port, name);
  }
  const taken = [];
  for (const entry of ports) {
    if (!(await isPortFree(entry.port, entry.host))) taken.push(entry);
  }
  if (taken.length > 0) {
    const lines = taken.map(({ name, port }) => `  port ${port} (${name}) is already in use`);
    const example = taken.map(({ name, port }) => `${name}=${port + 10}`).join(' ');
    throw new UsageError(
      `Cannot start:\n${lines.join('\n')}\nStop whatever is using it, or choose another port, for example:\n  ${example} ./start.sh`,
    );
  }
}
