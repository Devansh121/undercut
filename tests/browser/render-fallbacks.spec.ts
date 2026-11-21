import { expect, test } from '@playwright/test';
import { startTimeTrial, viewPixels, watchProblems } from './helpers';

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
  await startTimeTrial(page);
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

test('the sky is exposed and tone-mapped the same on the direct path as on the HDR path', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  test.setTimeout(120_000);
  /** Mean luma of the top 15 % of the view (sky in the chase camera) on a frozen grid start. */
  const skyLuma = async (hideFloat: boolean): Promise<number> => {
    const context = await browser.newContext({ viewport: { width: 480, height: 300 } });
    const page = await context.newPage();
    if (hideFloat) await page.addInitScript(hideFloatTargets);
    await page.goto('/?debug=1&quality=mobile');
    await startTimeTrial(page);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 90_000 });
    await page.evaluate(() => {
      const u = window.__undercut;
      u?.camera('chase-near');
      u?.restartLap();
      u?.setTimeScale(0);
      u?.resetFrameTimes();
    });
    await page.waitForFunction(() => (window.__undercut?.frameTimes().length ?? 0) >= 20, null, {
      timeout: 60_000,
    });
    const path = await page.evaluate(() => window.__undercut?.renderStats().renderPath);
    expect(path).toBe(hideFloat ? 'direct' : 'hdr');
    const { meanLuma } = await viewPixels(page, { from: 0, to: 0.15 });
    await context.close();
    return meanLuma;
  };
  const hdr = await skyLuma(false);
  const direct = await skyLuma(true);
  // Same tone map (Khronos PBR Neutral), same exposure, same sky: the paths differ only by the
  // HDR path's half-float target and its final-pass dither (about one 8-bit step). 5 % of the
  // mean covers that with margin; a sky written linear to the canvas (no tone map, no sRGB) is
  // 30-60 % darker in this band.
  expect(Math.abs(direct - hdr) / hdr).toBeLessThan(0.05);
  console.log(`sky luma: hdr ${hdr.toFixed(1)}, direct ${direct.toFixed(1)}`);
});

test('losing and restoring the WebGL context pauses, rebakes the lighting and draws again', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.goto('/?debug=1&quality=mobile');
  await startTimeTrial(page);
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
