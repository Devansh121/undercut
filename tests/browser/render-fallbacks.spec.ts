import { expect, test } from '@playwright/test';
import { viewPixels, watchProblems } from './helpers';

/**
 * The renderer adapts to what the GPU can do and survives losing its context. One project
 * covers both (the logic does not depend on the viewport).
 */
test('without renderable float targets High takes the direct path and still draws the race', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await page.addInitScript(() => {
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
  });
  await page.goto('/?debug=1&quality=high');
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
