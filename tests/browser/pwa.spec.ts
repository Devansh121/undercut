import { test, expect } from './base';

test('installable shell caches Mobile assets and opens offline without caching rooms', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'phone', 'one shell check on the phone');
  await page.goto('/?quality=mobile');
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
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-action=press-start]')).toBeVisible();
  await context.setOffline(false);
});
