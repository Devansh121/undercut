import {
  test as playwrightTest,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

/**
 * The `test` every browser spec uses (directly, or through fixtures.ts). It adds two guards for
 * software WebGL (SwiftShader) in CI:
 * 1. Preset guard: any navigation of the game page with `?debug=1` must name a preset, and only
 *    `lite` or `mobile` are allowed (any explicit heavier preset fails even without `debug=1`).
 *    Enforced at `Page.goto`, `Frame.goto`, and the `BrowserContext` document-navigation layer
 *    (covering redirects, `window.location` changes, links, and popups). Checks of the heavy
 *    presets run on the GPU in `npm run shots -- monza --lifecycle --sky-check`
 *    (tools/screenshots/shots.mjs).
 * 2. Clean WebGL teardown: closing a BrowserContext while a page holds a live SwiftShader WebGL2
 *    context stalls Chromium's single GPU process and makes the next `browser.newContext()` hang
 *    for 10–30 s on CI. Quitting the session and unloading to `about:blank` before teardown
 *    releases the context cleanly inside the test that opened it.
 */
export const ALLOWED_TEST_PRESETS = ['lite', 'mobile'] as const;

export function checkTestPreset(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url, 'http://test.invalid');
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.pathname !== '/' && u.pathname !== '/index.html') return null;
  const q = u.searchParams.get('quality');
  const allowed = q !== null && (ALLOWED_TEST_PRESETS as readonly string[]).includes(q);
  if (q !== null && !allowed) {
    return (
      `Browser test navigates to ${url} with quality=${q}. ` +
      'CI renders in software: use ?quality=lite or ?quality=mobile; heavier presets are ' +
      'checked on the GPU in npm run shots (--lifecycle, --sky-check).'
    );
  }
  if (u.searchParams.get('debug') === '1' && !allowed) {
    return (
      `Browser test navigates to ${url} with quality=${q ?? '(none: the High default)'}. ` +
      'CI renders in software: use ?quality=lite or ?quality=mobile; heavier presets are ' +
      'checked on the GPU in npm run shots (--lifecycle, --sky-check).'
    );
  }
  return null;
}

export function assertTestPreset(url: string): void {
  const msg = checkTestPreset(url);
  if (msg !== null) throw new Error(msg);
}

const presetViolations: string[] = [];

/** Return and clear any navigation-level preset guard violations recorded during the test. */
export function takePresetViolations(): string[] {
  return presetViolations.splice(0, presetViolations.length);
}

const guardedContexts = new WeakSet<BrowserContext>();

async function guardContext(context: BrowserContext): Promise<void> {
  if (guardedContexts.has(context)) return;
  guardedContexts.add(context);
  await context.route(
    (url) => checkTestPreset(url.href) !== null,
    async (route) => {
      if (route.request().resourceType() !== 'document') {
        await route.fallback();
        return;
      }
      const msg = checkTestPreset(route.request().url());
      if (msg !== null) {
        presetViolations.push(msg);
        await route.abort('blockedbyclient');
        return;
      }
      await route.fallback();
    },
  );
  const watchPage = (page: Page): void => {
    page.on('framenavigated', (frame) => {
      const msg = checkTestPreset(frame.url());
      if (msg !== null) presetViolations.push(msg);
    });
  };
  for (const existing of context.pages()) watchPage(existing);
  context.on('page', watchPage);
}

type GotoProto = { goto(url: string, options?: unknown): Promise<unknown>; __presetGuard?: true };

function patchGoto(proto: GotoProto): void {
  if (proto.__presetGuard) return;
  const goto = proto.goto;
  proto.goto = async function (this: unknown, url: string, options?: unknown) {
    assertTestPreset(url);
    const before = presetViolations.length;
    try {
      const response = (await goto.call(this, url, options)) as { url?: () => string } | null;
      const finalMsg = response?.url ? checkTestPreset(response.url()) : null;
      if (presetViolations.length > before || finalMsg !== null) {
        const msg =
          presetViolations.length > before
            ? presetViolations.splice(before, presetViolations.length - before)[0]
            : finalMsg!;
        await goto.call(this, 'about:blank').catch(() => undefined);
        throw new Error(msg);
      }
      return response;
    } catch (error) {
      if (presetViolations.length > before) {
        const [msg] = presetViolations.splice(before, presetViolations.length - before);
        throw new Error(msg, { cause: error });
      }
      throw error;
    }
  };
  proto.__presetGuard = true;
}

type BrowserProto = {
  newContext(...args: unknown[]): Promise<BrowserContext>;
  newPage(...args: unknown[]): Promise<Page>;
  __presetGuard?: true;
};

export const test = playwrightTest.extend<{ presetCheck: void }, { presetGuard: void }>({
  presetGuard: [
    async ({ browser }, use) => {
      // Guard every context, page, and frame in this worker (including contexts that tests and
      // fixtures open themselves): patch Page.goto, Frame.goto, and Browser.newContext/newPage.
      const browserProto = Object.getPrototypeOf(browser) as BrowserProto;
      if (!browserProto.__presetGuard) {
        const probeContext = await browser.newContext();
        const probePage = await probeContext.newPage();
        patchGoto(Object.getPrototypeOf(probePage) as GotoProto);
        patchGoto(Object.getPrototypeOf(probePage.mainFrame()) as GotoProto);
        await probeContext.close();

        const origNewContext = browserProto.newContext;
        browserProto.newContext = async function (this: Browser, ...args: unknown[]) {
          const ctx = await origNewContext.apply(this, args);
          await guardContext(ctx);
          return ctx;
        };

        const origNewPage = browserProto.newPage;
        browserProto.newPage = async function (this: Browser, ...args: unknown[]) {
          const page = await origNewPage.apply(this, args);
          await guardContext(page.context());
          return page;
        };

        browserProto.__presetGuard = true;
      }
      for (const ctx of browser.contexts()) {
        await guardContext(ctx);
      }
      await use();
    },
    { scope: 'worker', auto: true },
  ],
  presetCheck: [
    async ({ presetGuard: _presetGuard }, use) => {
      presetViolations.length = 0;
      await use();
      const violations = takePresetViolations();
      if (violations.length > 0) {
        throw new Error(violations[0]);
      }
    },
    { auto: true },
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
