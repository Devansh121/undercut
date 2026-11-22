import { expect, test } from './base';
import { viewPixels, watchProblems } from './helpers';

/**
 * Context loss and full Mobile-preset view rebuild (including PMREM environment rebake). Two full
 * Mobile shader/environment compiles take about a minute on CI's software renderer, so this runs
 * in the `lifecycle` Playwright project, which CI runs in the `build` job beside the `browser`
 * job (`npm run test:browser:lifecycle`).
 */
test.use({ viewport: { width: 480, height: 300 } });

test('losing and restoring the WebGL context pauses, rebakes the lighting and draws again', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.goto('/?debug=1&quality=mobile&world=lite');
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 90_000 });
  await page.waitForFunction(() => (window.__undercut?.state().tick as number) > 20);
  const builds = await page.evaluate(() => window.__undercut?.state().viewBuilds as number);
  await page.evaluate(() => {
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context unavailable');
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 600);
  });
  // The session pauses while the context is gone.
  await expect(page.locator('[data-testid=pause-menu]')).toBeVisible({ timeout: 10_000 });
  // A fresh view (environment rebaked with it) replaces the one whose context was lost.
  await page.waitForFunction((n) => (window.__undercut?.state().viewBuilds as number) > n, builds, {
    timeout: 30_000,
  });
  await expect(page.locator('[data-testid=loading]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Resume' }).click();
  const t0 = await page.evaluate(() => window.__undercut?.state().tick as number);
  await page.waitForFunction((t) => (window.__undercut?.state().tick as number) > t + 5, t0);
  const px = await viewPixels(page);
  expect(px.colours).toBeGreaterThan(500);
  expect(px.lumaStdDev).toBeGreaterThan(10);
  const stats = await page.evaluate(
    () => window.__undercut?.renderStats() as Record<string, number>,
  );
  expect(stats.environmentBakes).toBe(1);
  // Quitting afterwards releases only live objects (no deletes into the lost context).
  await page.evaluate(() => window.__undercut?.quit());
  await expect(page.getByRole('button', { name: /Start/ })).toBeVisible();
  expect(problems).toEqual([]);
});
