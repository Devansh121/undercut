import { test, expect } from './fixtures';

test('first-lap coach can be skipped and replayed, with safe phone rotation', async ({
  drive,
}, info) => {
  const { page } = drive;
  const tick = await page.evaluate(() => Number(window.__undercut!.state().tick));
  await expect
    .poll(() => page.evaluate(() => Number(window.__undercut!.state().tick)))
    .toBeGreaterThan(tick);

  await page.evaluate(() => window.__undercut!.pause());
  await page.locator('[data-action=replay-intro]').click();
  const intro = page.getByTestId('onboarding');
  await expect(intro).toBeVisible();
  await expect(intro).toContainText('1/4');
  await intro.locator('[data-action=intro-next]').click();
  await expect(intro).toContainText('driving line turns red');
  await intro.locator('[data-action=intro-skip]').click();
  await expect(intro).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('onboarding.v1'))).toBe('done');
  if (info.project.name === 'phone') {
    const controls = page.locator('.ut-touch [data-control]');
    for (const control of await controls.all()) {
      const rect = await control.boundingBox();
      expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator('#view').evaluate((e) => getComputedStyle(e).touchAction)).toBe(
      'none',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('rotate-prompt')).toBeVisible();
    expect(
      await page.getByTestId('pause-menu').evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-paused', '');
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByTestId('rotate-prompt')).toBeHidden();
    await expect(page.getByTestId('pause-menu')).toBeVisible();
  }
});

test('pause settings persist and reset to device defaults', async ({ drive }) => {
  const { page } = drive;
  await page.evaluate(() => window.__undercut!.pause());
  await page.locator('[data-setting=units] [data-value=mph]').click();
  expect(await page.evaluate(() => localStorage.getItem('settings.units'))).toBe('mph');
  await page.locator('[data-action=reset-settings]').click();
  await expect(page.locator('[data-setting=units] [data-value=kmh]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('[data-setting=quality] [data-value=auto]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
