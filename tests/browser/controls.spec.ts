import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openMenu } from './helpers';

/** The controls list, opened from the pause menu of the shared drive session. */
const BRAKE: Record<string, string> = {
  Keyboard: 'S or Down arrow',
  Gamepad: 'LT',
  Touch: 'Brake pedal',
};

/**
 * Put one standard-mapping pad on `navigator.getGamepads` in a running page; `fakePad(i, v)`
 * sets button `i`. `removePad` takes it away again so later tests on a shared page see no pad.
 */
async function installPad(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pad = {
      index: 0,
      id: 'Test pad (STANDARD GAMEPAD)',
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [{ ...pad, axes: [...pad.axes], buttons: [...pad.buttons] }, null, null, null],
    });
    (window as unknown as { fakePad: (i: number, v: number) => void }).fakePad = (i, v) => {
      pad.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v };
      pad.timestamp += 1;
    };
  });
}

async function padButton(page: Page, index: number, value: number): Promise<void> {
  await page.evaluate(
    ([i, v]) => (window as unknown as { fakePad: (i: number, v: number) => void }).fakePad(i, v),
    [index, value] as const,
  );
}

async function removePad(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (navigator as unknown as Record<string, unknown>).getGamepads;
  });
}

/** A frame-delayed second press would land within a few frames; wait well past that. */
const SETTLE_MS = 400;

test('the pause menu lists the controls for the device in use', async ({ drive: { page } }) => {
  await page.keyboard.press('Escape');
  const menu = page.locator('[data-testid=pause-menu]');
  await expect(menu).toBeVisible();
  const open = menu.getByRole('button', { name: 'Controls' });
  await open.click();

  const panel = page.locator('[data-testid=controls-panel]');
  const back = panel.getByRole('button', { name: 'Back' });
  await expect(panel).toBeVisible();
  const device = (await panel.locator('.controls__device').textContent())?.trim() ?? '';
  expect(Object.keys(BRAKE)).toContain(device);
  await expect(panel.locator('[data-row=brake] dd')).toHaveText(BRAKE[device] as string);
  await expect(panel.locator('.controls__note')).toContainText('twice');

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

  // Focus stays in the dialog.
  await expect(back).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(back).toBeFocused();

  // Esc closes the list and leaves the pause menu open.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(menu).toBeVisible();

  // Enter on Controls opens the list once; Enter on Back closes it once.
  await expect(open).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);
  await expect(panel).toBeVisible();
  await expect(back).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel).toBeHidden();
  await page.waitForTimeout(SETTLE_MS);
  await expect(panel).toBeHidden();
  await expect(menu).toBeVisible();

  // Esc again resumes.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('gamepad A on Back closes the controls list in the pause menu', async ({
  drive: { page },
}) => {
  test.skip(test.info().project.name !== 'desktop', 'gamepad cases run on desktop');
  await page.keyboard.press('Escape');
  const menu = page.locator('[data-testid=pause-menu]');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Controls' }).click();
  const panel = page.locator('[data-testid=controls-panel]');
  await expect(panel).toBeVisible();

  // The session does not tick while paused, so the pad never drives the car.
  await installPad(page);
  try {
    await padButton(page, 0, 1);
    await expect(panel).toBeHidden();
    await padButton(page, 0, 0);
    await page.waitForTimeout(SETTLE_MS);
    await expect(panel).toBeHidden();
    await expect(menu).toBeVisible();
  } finally {
    await removePad(page);
  }
  // A key press hands the menus back to the keyboard before resuming.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('main menu: the controls list keeps focus, and gamepad A on Back closes it without starting', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop', 'gamepad cases run on desktop');
  await page.goto('/?quality=lite');
  // The launch screen is a single prompt; the controls list is in the menu's top bar.
  await openMenu(page);
  const start = page.getByRole('button', { name: /Start/ });
  await expect(start).toBeVisible();
  await page.getByRole('button', { name: 'Controls' }).click();
  const panel = page.locator('[data-testid=controls-panel]');
  const back = panel.getByRole('button', { name: 'Back' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.controls__note')).toContainText('press Q twice');

  // Tab does not reach the launch screen behind the dialog.
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();

  await installPad(page);
  await padButton(page, 0, 1);
  await expect(panel).toBeHidden();
  await padButton(page, 0, 0);
  await page.waitForTimeout(SETTLE_MS);
  await expect(panel).toBeHidden();
  await expect(start).toBeVisible();
  await expect(start).toBeEnabled();
});
