import { createServer, request } from 'node:http';
import fs from 'node:fs';
import { startTimeTrial } from './helpers';
import { test, expect } from './base';

test('installable shell caches Mobile assets and opens offline without caching rooms', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'phone', 'one shell check on the phone');
  let updated = false;
  const workerSource = fs.readFileSync('apps/web/dist/sw.js', 'utf8');
  const server = createServer((req, res) => {
    if (req.url === '/sw.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(
        updated ? workerSource.replace(/(race-shell-[a-f0-9]+)/g, '$1-update') : workerSource,
      );
      return;
    }
    const upstream = request(
      new URL(req.url ?? '/', baseURL),
      { headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode ?? 500, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no test address');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(origin + '/?debug=1&quality=mobile&world=lite&offline=1');
    const manifest = (await page.evaluate(async () =>
      (await fetch('./manifest.webmanifest')).json(),
    )) as { display: string; orientation: string; icons: { sizes: string }[] };
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('landscape');
    expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512']);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    const cached = await page.evaluate(async () => {
      const names = (await caches.keys()).filter((n) => n.startsWith('race-shell-'));
      const cache = await caches.open(names[0]!);
      return (await cache.keys()).map((r) => new URL(r.url).pathname);
    });
    expect(cached.some((p) => p.includes('car_mobile.glb'))).toBe(true);
    expect(cached.some((p) => p.startsWith('/rooms'))).toBe(false);
    // Install a new build while an old page is open: it must wait rather than mix chunks.
    updated = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await expect
      .poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).waiting)))
      .toBe(true);
    expect(
      await page.evaluate(
        async () => (await caches.keys()).filter((n) => n.startsWith('race-shell-')).length,
      ),
    ).toBe(2);
    await page.goto('about:blank');
    await expect
      .poll(async () => {
        const worker = context.serviceWorkers()[0];
        return worker
          ? worker.evaluate(async () =>
              (await caches.keys()).filter((n) => n.startsWith('race-shell-')),
            )
          : [];
      })
      .toEqual([expect.stringMatching(/-update$/)]);
    await context.setOffline(true);
    await page.goto(origin + '/?debug=1&quality=mobile&world=lite&offline=1');
    await expect(page.locator('[data-action=press-start]')).toBeVisible();
    await startTimeTrial(page);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
    await expect
      .poll(() => page.evaluate(() => Number(window.__undercut!.state().tick)))
      .toBeGreaterThan(20);
    await context.setOffline(false);
  } finally {
    await page.evaluate(() => window.__undercut?.quit()).catch(() => {});
    await page.goto('about:blank');
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
