import { expect, test } from '@playwright/test';

/** The player's car drives the audio engine: it starts on the Start click and follows pause. */
test('the engine sound starts on the Start click and suspends on pause', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto('/?debug=1&quality=mobile');
  await page.waitForFunction(() => Boolean(window.__undercut));
  expect(await page.evaluate(() => window.__undercut?.audioStatus())).toBe('none');

  // A real click: browsers only let audio start from a user gesture.
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => window.__undercut?.audioStatus()), { timeout: 15_000 })
    .toBe('running');

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=pause-menu]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__undercut?.audioStatus())).toBe('suspended');

  // The volume sliders are in the pause menu and keep their values across a reload.
  const engine = page.locator('[data-slider=engine] input');
  await engine.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-slider=engine] output')).toHaveText('80%');

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => page.evaluate(() => window.__undercut?.audioStatus())).toBe('running');

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__undercut));
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slider=engine] output')).toHaveText('80%');
  expect(problems).toEqual([]);
});
