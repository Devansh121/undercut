import { expect, test } from './fixtures';

/** The controls list, opened from the pause menu of the shared drive session. */
const BRAKE: Record<string, string> = {
  Keyboard: 'S or Down arrow',
  Gamepad: 'LT',
  Touch: 'Brake pedal',
};

test('the pause menu lists the controls for the device in use', async ({ drive: { page } }) => {
  await page.keyboard.press('Escape');
  const menu = page.locator('[data-testid=pause-menu]');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Controls' }).click();

  const panel = page.locator('[data-testid=controls-panel]');
  await expect(panel).toBeVisible();
  const device = (await panel.locator('.controls__device').textContent())?.trim() ?? '';
  expect(Object.keys(BRAKE)).toContain(device);
  await expect(panel.locator('[data-row=brake] dd')).toHaveText(BRAKE[device] as string);
  await expect(panel).toContainText('gear down twice at a standstill selects reverse');

  // Fits the viewport with nothing cut off sideways.
  const fit = await panel.locator('.controls__card').evaluate((card) => {
    const r = card.getBoundingClientRect();
    return {
      inside: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      sideways: card.scrollWidth > card.clientWidth,
    };
  });
  expect(fit).toEqual({ inside: true, sideways: false });
  // Evidence capture for the PR, only when asked for.
  if (process.env.CONTROLS_SHOT && test.info().project.name === 'desktop')
    await page.screenshot({ path: process.env.CONTROLS_SHOT });

  // Esc closes the list and leaves the pause menu open; Esc again resumes.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});
