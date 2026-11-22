import { expect, test } from './base';
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
  await page.waitForFunction(() => window.__undercut?.loadTimes().total !== undefined, null, {
    timeout: 30_000,
  });
  const times = await page.evaluate(() => window.__undercut?.loadTimes() ?? {});
  console.log(`start-up (${test.info().project.name}): ${JSON.stringify(times)}`);
  expect(times.total).toBeLessThan(START_BUDGET_MS);
  // Once the real-time cold start is timed, speed up the sim so reaching 150 km/h does not burn
  // dozens of Mobile-preset software-WebGL frames.
  await page.evaluate(() => {
    window.__undercut?.setTimeScale(4);
    window.__undercut?.drive({ throttle: 1, steer: 0 });
  });
  await expect
    .poll(async () => Number(await page.locator('[data-testid=speed]').textContent()), {
      timeout: 30_000,
    })
    .toBeGreaterThan(150);
  expect(problems).toEqual([]);
});
