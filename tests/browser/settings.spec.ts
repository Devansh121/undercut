import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openMenu } from './helpers';

/** The Settings screen, opened from the main menu's top bar. Desktop: keyboard and an emulated pad. */
async function openSettings(page: Page): Promise<void> {
  await page.locator('.shell__top [data-action=settings]').click();
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'settings');
}

const slot = (page: Page, action: string, n: number) =>
  page.locator(`.binds__row[data-action=${action}] [data-slot="${n}"]`);

test('keyboard rebinding: conflicts are moved and named, Esc cancels, it is saved, reset restores', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop', 'keyboard and pad cases run on desktop');
  await page.goto('/?quality=lite');
  await openMenu(page);
  await openSettings(page);
  const notice = page.locator('.settings__notice');
  await expect(page.locator('[data-setting=bindDevice] [aria-checked=true]')).toHaveText(
    'Keyboard',
  );

  // Esc while waiting cancels the rebinding and stays on Settings.
  await slot(page, 'gearUp', 0).click();
  await expect(slot(page, 'gearUp', 0)).toHaveText('Press a key');
  await page.keyboard.press('Escape');
  await expect(slot(page, 'gearUp', 0)).toHaveText('E');
  await expect(notice).toHaveText('No change.');
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'settings');

  // Q belongs to gear down: it moves, and gear down is flagged as unbound.
  await slot(page, 'gearUp', 0).click();
  await page.keyboard.press('KeyQ');
  await expect(slot(page, 'gearUp', 0)).toHaveText('Q');
  await expect(slot(page, 'gearDown', 0)).toHaveText('Not bound');
  await expect(notice).toHaveText(
    'Q now does Gear up. It was taken off Gear down. Not bound now: Gear down.',
  );
  await expect(page.locator('.binds__row[data-action=gearDown]')).toHaveClass(/is-unbound/);
  // The Enter that starts a rebinding is not taken as the new key.
  await slot(page, 'gearDown', 0).focus();
  await page.keyboard.press('Enter');
  await expect(slot(page, 'gearDown', 0)).toHaveText('Press a key');
  await page.keyboard.press('KeyG');
  await expect(slot(page, 'gearDown', 0)).toHaveText('G');

  // Pause keeps a control.
  await slot(page, 'pause', 1).click();
  await page.keyboard.press('Delete');
  await expect(slot(page, 'pause', 1)).toHaveText('Not bound');
  await slot(page, 'pause', 0).click();
  await page.keyboard.press('Delete');
  await expect(notice).toHaveText('Pause needs a control, so that change was not made.');
  await expect(slot(page, 'pause', 0)).toHaveText('Esc');

  // Saved: a reload keeps it, and the controls list reads it.
  await page.reload();
  await openMenu(page);
  await page.locator('.shell__top [data-action=controls]').click();
  await expect(page.locator('[data-testid=controls-panel] [data-row=gearUp] dd')).toHaveText('Q');
  await page.keyboard.press('Escape');
  await openSettings(page);
  await expect(slot(page, 'gearDown', 0)).toHaveText('G');

  await page.locator('[data-action=reset-bindings]').click();
  await expect(notice).toHaveText('Keyboard controls reset to defaults.');
  await expect(slot(page, 'gearUp', 0)).toHaveText('E');
  await expect(slot(page, 'pause', 1)).toHaveText('P');
});

test('a controller rebinds its own buttons and steps the sections on the shoulders', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop', 'keyboard and pad cases run on desktop');
  await page.goto('/?quality=lite');
  await openMenu(page);
  await openSettings(page);
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
      value: () => [{ ...pad, axes: [...pad.axes], buttons: [...pad.buttons] }],
    });
    (window as unknown as { fakePad: (i: number, v: number) => void }).fakePad = (i, v) => {
      pad.buttons[i] = { pressed: v > 0.5, touched: v > 0, value: v };
    };
  });
  const tap = async (i: number): Promise<void> => {
    const set = (v: number) =>
      page.evaluate(
        ([b, x]) =>
          (window as unknown as { fakePad: (i: number, v: number) => void }).fakePad(b, x),
        [i, v] as const,
      );
    const frames = () =>
      page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
    await set(1);
    await frames();
    await set(0);
    await frames();
  };

  // The first pad press (LS: nothing in menus) switches the bindings to the controller.
  await tap(10);
  await expect(page.locator('[data-setting=bindDevice] [aria-checked=true]')).toHaveText(
    'Controller',
  );
  await expect(slot(page, 'brake', 0).locator('.glyph')).toHaveText('LT');

  // A pad rebinding: the press that starts it is not taken; the next one is. X was overtake's.
  await slot(page, 'drs', 0).focus();
  await tap(0);
  await expect(slot(page, 'drs', 0)).toHaveText('Press a button');
  await tap(2);
  await expect(slot(page, 'drs', 0).locator('.glyph')).toHaveText('X');
  await expect(slot(page, 'overtake', 0)).toHaveText('Not bound');

  // RB steps to the next section; LB back.
  await tap(5);
  await expect(page.locator('.settings-screen__tabs [data-tab=assists]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await tap(4);
  await expect(page.locator('.settings-screen__tabs [data-tab=controls]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // B leaves Settings.
  await tap(1);
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
});

test('accessibility and display settings apply at once and are kept; credits open', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop', 'one layout is enough here');
  await page.goto('/?quality=lite');
  await openMenu(page);
  await openSettings(page);
  const html = page.locator('html');
  await page.locator('.settings-screen__tabs [data-tab=accessibility]').click();
  await page.locator('[data-setting=colourBlind]').click();
  await expect(html).toHaveAttribute('data-cb', 'on');
  await page.locator('[data-setting=textSize] [data-value=larger]').click();
  await expect(html).toHaveAttribute('data-text', 'larger');
  const fs12 = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs-12'));
  expect((await fs12()).trim()).toBe('16px');
  await page.locator('[data-setting=reducedMotion] [data-value=on]').click();
  await expect(html).toHaveAttribute('data-motion', 'reduce');

  await page.locator('.settings-screen__tabs [data-tab=display]').click();
  const scale = page.locator('[data-setting=hudScale] [role=slider]');
  await scale.focus();
  await page.keyboard.press('ArrowRight');
  await expect(scale).toHaveAttribute('aria-valuenow', '1.05');
  await page.locator('[data-setting=units] [data-value=mph]').click();

  await page.reload();
  await expect(html).toHaveAttribute('data-cb', 'on');
  await expect(html).toHaveAttribute('data-text', 'larger');
  await expect(html).toHaveAttribute('data-motion', 'reduce');
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--hud-scale')),
  ).toBe('1.05');
  await openMenu(page);
  await openSettings(page);
  await page.locator('.settings-screen__tabs [data-tab=display]').click();
  await expect(page.locator('[data-setting=units] [aria-checked=true]')).toHaveText('mph');

  await page.locator('[data-testid=settings] [data-action=credits]').click();
  const credits = page.locator('[data-testid=credits]');
  await expect(credits).toBeVisible();
  await expect(credits).toContainText('three.js');
  await expect(credits).toContainText('OpenStreetMap');
  await expect(credits).toContainText('Poly Haven');
  // No governing-body name reaches the product (spelled from parts: the repo's name check).
  await expect(credits).not.toContainText(['F', 'IA'].join(''));
  await credits.locator('[data-action=back]').click();
  await expect(html).toHaveAttribute('data-screen', 'settings');
});
