import { createServer, request } from 'node:http';
import fs from 'node:fs';
import { startTimeTrial } from './helpers';
import { test, expect } from './base';

test('installable shell survives a redirecting host, updates on reload, and drives offline on Auto or a chosen preset', async ({
  page,
  context,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'phone', 'one shell check on the phone');
  let updated = false;
  let networkInfoHits = 0;
  const workerSource = fs.readFileSync('apps/web/dist/sw.js', 'utf8');
  // In front of the static server: answers /index.html with a redirect to / as Cloudflare's
  // static assets do, and can swap in a "new build" of the worker.
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/index.html') {
      res.writeHead(307, { Location: '/' });
      res.end();
      return;
    }
    if (path === '/sw.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(
        updated ? workerSource.replace(/(race-shell-[a-f0-9]+)/g, '$1-update') : workerSource,
      );
      return;
    }
    if (path === '/network-info') networkInfoHits++;
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
  const home = origin + '/?debug=1&world=lite&offline=1';
  const shellCaches = (): Promise<string[]> =>
    page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('race-shell-')));
  try {
    await page.goto(home + '&quality=mobile');
    const manifest = (await page.evaluate(async () =>
      (await fetch('./manifest.webmanifest')).json(),
    )) as { display: string; orientation: string; icons: { sizes: string; purpose: string }[] };
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.orientation).toBe('landscape');
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
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
    expect(cached).toContain('/');
    expect(cached.some((p) => p.includes('car_mobile.glb'))).toBe(true);
    expect(cached.filter((p) => /^\/(rooms|network-info|index\.html)/.test(p))).toEqual([]);

    // Dynamic endpoints always reach the network (invite addresses change with the Wi-Fi).
    const before = networkInfoHits;
    await page.evaluate(async () => {
      await fetch('./network-info');
      await fetch('./network-info');
    });
    expect(networkInfoHits).toBe(before + 2);

    // A second visit is answered from the cache, not with a redirected response.
    await page.reload();
    await expect(page.locator('[data-action=press-start]')).toBeVisible();
    await page.goto(origin + '/index.html?debug=1&quality=mobile&offline=1');
    await expect(page.locator('[data-action=press-start]')).toBeVisible();

    // A new build installs beside this page and offers a reload instead of mixing chunks.
    updated = true;
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    const prompt = page.getByTestId('update-ready');
    await expect(prompt).toBeVisible();
    expect(await shellCaches()).toHaveLength(2);
    await Promise.all([page.waitForEvent('load'), prompt.getByRole('button').click()]);
    await expect(page.locator('[data-action=press-start]')).toBeVisible();
    await expect.poll(shellCaches).toEqual([expect.stringMatching(/-update$/)]);
    await expect(prompt).toBeHidden();

    // Offline on Auto (no preset in the URL, so no debug API either) with a saved Medium pick
    // the cache does not hold: the session starts on Mobile instead of stopping on a download.
    await page.evaluate(() => {
      localStorage.removeItem('settings.quality');
      localStorage.setItem('settings.quality.auto', 'medium');
    });
    await context.setOffline(true);
    await page.goto(origin + '/?world=lite');
    await expect(page.locator('[data-action=press-start]')).toBeVisible();
    await startTimeTrial(page);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
    await expect(page.locator('html')).toHaveAttribute('data-quality', 'mobile');
    await expect(page.getByTestId('loading')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('settings.quality.auto'))).toBe('medium');
    // No debug API in this session: quit as a player does. Quitting stops drawing but keeps the
    // page's one WebGL context (createRenderer); unloading to about:blank in `finally` releases
    // it, and first runs whatever the GPU still has queued. On software WebGL that is the
    // session's start-up work plus at most two frames (FramePacer): about 4 s idle, 9 to 11 s
    // on two busy cores.
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-menu').locator('[data-action=quit]').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-screen', 'drive');

    // Offline with Medium chosen by the player (not Auto): the session starts on Mobile too,
    // says so, and keeps the player's choice for when the connection returns.
    await page.evaluate(() => localStorage.setItem('settings.quality', 'medium'));
    await page.goto(origin + '/?world=lite');
    await expect(page.locator('[data-action=press-start]')).toBeVisible();
    await startTimeTrial(page);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
    await expect(page.locator('html')).toHaveAttribute('data-quality', 'mobile');
    await expect(page.getByTestId('loading')).toHaveCount(0);
    await expect(page.getByTestId('hud-message')).toContainText(
      'Medium needs a connection: running on Mobile',
    );
    expect(await page.evaluate(() => localStorage.getItem('settings.quality'))).toBe('medium');
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-menu').locator('[data-action=quit]').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-screen', 'drive');
    await context.setOffline(false);
  } finally {
    await context.setOffline(false);
    await page.evaluate(() => window.__undercut?.quit()).catch(() => {});
    await page.goto('about:blank');
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
