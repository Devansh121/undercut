import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyInterfaces } from './network.mjs';
import { UsageError, assertPortsFree, freePort, portFromEnv } from './ports.mjs';
import { isRoomsPath, resolveStaticPath } from './static.mjs';

const v4 = (address) => ({ address, family: 'IPv4', internal: false });

describe('classifyInterfaces', () => {
  it('puts Wi-Fi and Ethernet on the LAN line and the rest under Other', () => {
    const result = classifyInterfaces({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      wlp2s0: [v4('192.168.1.10'), { address: 'fe80::1', family: 'IPv6', internal: false }],
      enp3s0: [v4('10.0.0.7')],
      docker0: [v4('172.17.0.1')],
      'br-1a2b3c': [v4('172.18.0.1')],
      tailscale0: [v4('100.84.1.2')],
      utun3: [v4('10.8.0.2')],
      eth9: [v4('100.100.3.4')],
      en5: [v4('169.254.3.3')],
    });
    expect(result.lan).toEqual([
      { name: 'wlp2s0', address: '192.168.1.10' },
      { name: 'enp3s0', address: '10.0.0.7' },
    ]);
    expect(result.other.map((i) => i.name)).toEqual([
      'docker0',
      'br-1a2b3c',
      'tailscale0',
      'utun3',
      'eth9',
      'en5',
    ]);
  });

  it('accepts the numeric family some Node versions report', () => {
    const result = classifyInterfaces({
      en0: [{ address: '192.168.0.5', family: 4, internal: false }],
    });
    expect(result.lan).toEqual([{ name: 'en0', address: '192.168.0.5' }]);
  });
});

describe('resolveStaticPath', () => {
  const root = path.resolve('/srv/dist');

  it('maps paths inside the root', () => {
    expect(resolveStaticPath(root, '/assets/a.js?x=1')).toBe(path.join(root, 'assets/a.js'));
    expect(resolveStaticPath(root, '/')).toBe(path.join(root, 'index.html'));
  });

  it('never escapes the root', () => {
    for (const url of ['/../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/a/../../b']) {
      const resolved = resolveStaticPath(root, url);
      expect(resolved === null || resolved.startsWith(root + path.sep)).toBe(true);
    }
  });

  it('rejects malformed escapes and NUL bytes', () => {
    expect(resolveStaticPath(root, '/%E0%A4%A')).toBeNull();
    expect(resolveStaticPath(root, '/a%00b')).toBeNull();
  });
});

describe('isRoomsPath', () => {
  it('matches /rooms and below only', () => {
    expect(isRoomsPath('/rooms')).toBe(true);
    expect(isRoomsPath('/rooms/abc?x=1')).toBe(true);
    expect(isRoomsPath('/roomsx')).toBe(false);
    expect(isRoomsPath('/assets/rooms.js')).toBe(false);
  });
});

describe('ports', () => {
  it('reads a port from the environment with a default', () => {
    process.env.TEST_PORT_X = '6001';
    expect(portFromEnv('TEST_PORT_X', 1)).toBe(6001);
    delete process.env.TEST_PORT_X;
    expect(portFromEnv('TEST_PORT_X', 1234)).toBe(1234);
    process.env.TEST_PORT_X = 'abc';
    expect(() => portFromEnv('TEST_PORT_X', 1)).toThrow(UsageError);
    delete process.env.TEST_PORT_X;
  });

  it('names a port that is already in use', async () => {
    const net = await import('node:net');
    const port = await freePort();
    const server = net.createServer().listen(port, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      await expect(assertPortsFree([{ name: 'PORT', port, host: '127.0.0.1' }])).rejects.toThrow(
        `port ${port} (PORT) is already in use`,
      );
    } finally {
      server.close();
    }
  });

  it('rejects two settings that share a port', async () => {
    await expect(
      assertPortsFree([
        { name: 'PORT', port: 7000, host: '127.0.0.1' },
        { name: 'HTTPS_PORT', port: 7000, host: '127.0.0.1' },
      ]),
    ).rejects.toThrow('both 7000');
  });
});
