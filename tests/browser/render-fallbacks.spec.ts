import { expect, takePresetViolations, test } from './base';
import { startTimeTrial, viewPixels, watchProblems } from './helpers';

/**
 * The renderer adapts to what the GPU can do (the preset guard and the direct-path fallback
 * without float targets). Context loss and Mobile PMREM rebake run in the `lifecycle` project
 * (context-loss.spec.ts). One project covers this at a small viewport: software WebGL
 * in CI pays for every pixel.
 */
test.use({ viewport: { width: 480, height: 300 } });

/** Make half-float colour targets unrenderable, as on GPUs without the extensions. */
function hideFloatTargets(): void {
  const hidden = new Set(['EXT_color_buffer_float', 'EXT_color_buffer_half_float']);
  const proto = WebGL2RenderingContext.prototype;
  const getExtension = proto.getExtension as (name: string) => unknown;
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
  await page.goto('/?debug=1&quality=mobile&world=lite');
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
