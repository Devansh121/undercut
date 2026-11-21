import { expect, takePresetViolations, test } from './base';
import { viewPixels, watchProblems } from './helpers';

/**
 * The renderer adapts to what the GPU can do and survives losing its context. One project
 * covers both (the logic does not depend on the viewport), at a small viewport: software WebGL
 * in CI pays for every pixel.
 */
test.use({ viewport: { width: 480, height: 300 } });

/** Make half-float colour targets unrenderable, as on GPUs without the extensions. */
function hideFloatTargets(): void {
  const hidden = new Set(['EXT_color_buffer_float', 'EXT_color_buffer_half_float']);
  const proto = WebGL2RenderingContext.prototype;
  const getExtension = proto.getExtension;
  proto.getExtension = function (this: WebGL2RenderingContext, name: string) {
    return hidden.has(name) ? null : getExtension.call(this, name);
  } as typeof proto.getExtension;
  const supported = proto.getSupportedExtensions;
  proto.getSupportedExtensions = function (this: WebGL2RenderingContext) {
    return (supported.call(this) ?? []).filter((n) => !hidden.has(n));
  };
}
test('the preset guard rejects heavy or unspecified presets across all navigation paths', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  for (const url of [
    '/?debug=1',
    '/?debug=1&quality=high',
    '/?debug=1&quality=ultra',
    '/?debug=1&quality=medium',
    '/?quality=high',
  ]) {
    let caught: unknown;
    try {
      await page.goto(url);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('CI renders in software');
  }

  // Main-frame goto cannot bypass the guard.
  let frameCaught: unknown;
  try {
    await page.mainFrame().goto('/?debug=1&quality=high');
  } catch (error) {
    frameCaught = error;
  }
  expect(frameCaught).toBeInstanceOf(Error);
  expect((frameCaught as Error).message).toContain('CI renders in software');

  // Server redirects to a disallowed preset are aborted and rejected with the guard message.
  await page.route('**/preset-guard-redirect-test', (route) =>
    route.fulfill({ status: 302, headers: { location: '/?debug=1&quality=high' } }),
  );
  let redirectCaught: unknown;
  try {
    await page.goto('/preset-guard-redirect-test');
  } catch (error) {
    redirectCaught = error;
  }
  await page.unroute('**/preset-guard-redirect-test');
  expect(redirectCaught).toBeInstanceOf(Error);
  expect((redirectCaught as Error).message).toContain('CI renders in software');

  // Client-side location changes to a disallowed preset are aborted before loading the document.
  await page.goto('/input-lab.html');
  const failed = page.waitForEvent(
    'requestfailed',
    (req) => req.resourceType() === 'document' && req.url().includes('quality=high'),
  );
  await page.evaluate(() => {
    window.location.href = '/?debug=1&quality=high';
  });
  await failed;
  const violations = takePresetViolations();
  expect(violations.length).toBeGreaterThan(0);
  expect(violations[0]).toContain('CI renders in software');
  expect(page.url()).not.toContain('quality=high');
});

test('without renderable float targets the HDR preset takes the direct path and still draws the race', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.addInitScript(hideFloatTargets);
  // Mobile has the HDR pipeline (half-float target, MSAA, PMREM) like High, at a fraction of
  // the software-rendering cost; effectiveQuality is unit-tested on every preset.
  await page.goto('/?debug=1&quality=mobile');
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 90_000 });
  await page.evaluate(() => window.__undercut?.drive({ throttle: 1, steer: 0 }));
  await page.waitForFunction(() => (window.__undercut?.state().tick as number) > 20);
  const stats = await page.evaluate(
    () => window.__undercut?.renderStats() as Record<string, unknown>,
  );
  expect(stats.renderPath).toBe('direct');
  const px = await viewPixels(page);
  expect(px.colours).toBeGreaterThan(500);
  expect(px.lumaStdDev).toBeGreaterThan(10);
  expect(px.meanLuma).toBeGreaterThan(30);
  // three.js says once that the extension is missing: that is the condition under test.
  expect(
    problems.filter((p) => !p.includes('EXT_color_buffer_float extension not supported')),
  ).toEqual([]);
});

test('losing and restoring the WebGL context pauses, rebakes the lighting and draws again', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.goto('/?debug=1&quality=mobile');
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
