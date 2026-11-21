import { test as base, expect, type Page } from '@playwright/test';

/**
 * One drive session per worker, shared by the tests that do not need a fresh load. Software
 * WebGL makes a cold load and every frame expensive, so these tests run on the `lite` render
 * preset (small canvas, no shadow map, no environment prefilter; same scene, cameras and logic)
 * and start from an in-page reset (`__undercut.resetForTest()`) instead of a reload. Start-up
 * itself is covered by one cold-start test per project at the Mobile preset (cold-start.spec.ts).
 */
export interface DriveFixture {
  page: Page;
  /** Console errors, warnings and page errors seen during this test. */
  problems: string[];
}

export const test = base.extend<{ drive: DriveFixture }, { sharedPage: Page }>({
  sharedPage: [
    async ({ browser }, use, workerInfo) => {
      const u = workerInfo.project.use;
      const context = await browser.newContext({
        viewport: u.viewport ?? null,
        deviceScaleFactor: u.deviceScaleFactor ?? 1,
        isMobile: u.isMobile ?? false,
        hasTouch: u.hasTouch ?? false,
        baseURL: u.baseURL ?? `http://127.0.0.1:${process.env.TEST_PORT ?? 4173}`,
      });
      const page = await context.newPage();
      await page.goto('/?debug=1&quality=lite');
      await page.getByRole('button', { name: /Start/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
      await use(page);
      await context.close();
    },
    { scope: 'worker', timeout: 90_000 },
  ],
  drive: async ({ sharedPage }, use) => {
    const problems: string[] = [];
    const onConsole = (msg: { type(): string; text(): string }): void => {
      if (msg.type() === 'error' || msg.type() === 'warning')
        problems.push(`${msg.type()}: ${msg.text()}`);
    };
    const onError = (e: Error): void => {
      problems.push(`pageerror: ${e.message}`);
    };
    sharedPage.on('console', onConsole);
    sharedPage.on('pageerror', onError);
    await sharedPage.evaluate(() => window.__undercut?.resetForTest());
    await expect(sharedPage.locator('[data-testid=pause-menu]')).toBeHidden();
    await use({ page: sharedPage, problems });
    sharedPage.off('console', onConsole);
    sharedPage.off('pageerror', onError);
    // Every shared-session test is also a no-console-problems test.
    expect(problems, 'console errors or warnings during the test').toEqual([]);
  },
});

export { expect };
