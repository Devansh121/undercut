import { test as playwrightTest } from '@playwright/test';

/**
 * The `test` every browser spec uses (directly, or through fixtures.ts). It adds two guards for
 * software WebGL (SwiftShader) in CI:
 * 1. Preset guard: any navigation of the game page with `?debug=1` must name a preset, and only
 *    `lite` or `mobile` are allowed (any explicit heavier preset fails even without `debug=1`).
 *    Checks of the heavy presets run on the GPU in `npm run shots -- monza --lifecycle --sky-check`
 *    (tools/screenshots/shots.mjs).
 * 2. Clean WebGL teardown: closing a BrowserContext while a page holds a live SwiftShader WebGL2
 *    context stalls Chromium's single GPU process and makes the next `browser.newContext()` hang
 *    for 10–30 s on CI. Quitting the session and unloading to `about:blank` before teardown
 *    releases the context cleanly inside the test that opened it.
 */
export const ALLOWED_TEST_PRESETS = ['lite', 'mobile'] as const;

export function assertTestPreset(url: string): void {
  if (url === 'about:blank') return;
  const u = new URL(url, 'http://test.invalid');
  if (u.pathname !== '/' && u.pathname !== '/index.html') return;
  const q = u.searchParams.get('quality');
  const allowed = q !== null && (ALLOWED_TEST_PRESETS as readonly string[]).includes(q);
  if (q !== null && !allowed) {
    throw new Error(
      `Browser test navigates to ${url} with quality=${q}. ` +
        'CI renders in software: use ?quality=lite or ?quality=mobile; heavier presets are ' +
        'checked on the GPU in npm run shots (--lifecycle, --sky-check).',
    );
  }
  if (u.searchParams.get('debug') === '1' && !allowed) {
    throw new Error(
      `Browser test navigates to ${url} with quality=${q ?? '(none: the High default)'}. ` +
        'CI renders in software: use ?quality=lite or ?quality=mobile; heavier presets are ' +
        'checked on the GPU in npm run shots (--lifecycle, --sky-check).',
    );
  }
}

type GotoProto = { goto(url: string, options?: unknown): Promise<unknown>; __presetGuard?: true };

export const test = playwrightTest.extend<object, { presetGuard: void }>({
  presetGuard: [
    async ({ browser }, use) => {
      // Guard every page of this worker, including pages that tests and fixtures open
      // themselves: patch the Page prototype's goto once.
      const context = await browser.newContext();
      const page = await context.newPage();
      const proto = Object.getPrototypeOf(page) as GotoProto;
      if (!proto.__presetGuard) {
        const goto = proto.goto;
        proto.goto = function (this: unknown, url: string, options?: unknown) {
          assertTestPreset(url);
          return goto.call(this, url, options);
        };
        proto.__presetGuard = true;
      }
      await context.close();
      await use();
    },
    { scope: 'worker', auto: true },
  ],
  page: async ({ page }, use, testInfo) => {
    await use(page);
    if (page.isClosed() || testInfo.status !== testInfo.expectedStatus) return;
    // Only pages that actually started a WebGL view need unloading before context.close().
    const hasView = await page
      .evaluate(() => {
        if (window.__undercut) {
          try {
            window.__undercut.quit();
          } catch {
            // already quit or never started
          }
          return true;
        }
        return document.getElementById('view') !== null;
      })
      .catch(() => false);
    if (hasView) {
      await page.goto('about:blank').catch(() => undefined);
    }
  },
});

export { expect } from '@playwright/test';
