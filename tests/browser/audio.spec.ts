import { expect, test } from './base';
import { coldStart, watchProblems } from './helpers';

/**
 * The player's car drives the audio engine: it starts on the Start click (a real gesture) and
 * follows pause. Where the browser cannot run the audio worklet (no AudioWorklet, for example
 * an insecure context), the documented behaviour is a clean silent fallback; the page reports
 * which applies and the test checks that, whichever it is.
 */
test('engine sound starts on the Start click, suspends on pause, and keeps its volumes', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = watchProblems(page);
  await coldStart(page, 'lite');
  const capability = await page.evaluate(() => window.__undercut?.audioCapability());
  const status = (): Promise<string | undefined> =>
    page.evaluate(() => window.__undercut?.audioStatus());
  if (capability?.supported) {
    await expect.poll(status, { timeout: 15_000 }).toBe('running');
  } else {
    await expect.poll(status, { timeout: 15_000 }).toBe('silent');
  }

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=pause-menu]')).toBeVisible();
  if (capability?.supported) {
    await expect.poll(status).toBe('suspended');
  } else {
    await expect(page.locator('[data-testid=pause-menu]')).toContainText(
      'No sound in this browser',
    );
  }

  // Volume sliders in the pause menu; the value is saved with the settings.
  const engine = page.locator('[data-slider=engine] input');
  await engine.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-slider=engine] output')).toHaveText('80%');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('settings.audio') ?? '{}').engine),
    )
    .toBeCloseTo(0.8, 6);

  await page.getByRole('button', { name: 'Resume' }).click();
  if (capability?.supported) await expect.poll(status).toBe('running');
  expect(problems).toEqual([]);
});
