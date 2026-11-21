import { expect, test } from '@playwright/test';
import { coldStart, watchProblems } from './helpers';

/**
 * The one cold start per project at the real Mobile preset (shadows, environment prefilter,
 * full materials), from the launch screen's Start button to a running session with its first
 * frames drawn. Every other drive test shares a session (fixtures.ts).
 *
 * Budget: 25 s from Start to the first frames drawn on software WebGL. Measured: 3.5 s on the
 * development laptop; the CI runner's software rendering is several times slower.
 */
const START_BUDGET_MS = 25_000;

test('cold start: launch to a driving session within the start-up budget', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchProblems(page);
  await coldStart(page, 'mobile');
  // The car is driving and the HUD follows it.
  await page.evaluate(() => window.__undercut?.drive({ throttle: 1, steer: 0 }));
  await expect
    .poll(async () => Number(await page.locator('[data-testid=speed]').textContent()), {
      timeout: 30_000,
    })
    .toBeGreaterThan(150);
  await page.waitForFunction(() => window.__undercut?.loadTimes().total !== undefined, null, {
    timeout: 30_000,
  });
  const times = await page.evaluate(() => window.__undercut?.loadTimes() ?? {});
  console.log(`start-up (${test.info().project.name}): ${JSON.stringify(times)}`);
  expect(times.total).toBeLessThan(START_BUDGET_MS);
  expect(problems).toEqual([]);
});
