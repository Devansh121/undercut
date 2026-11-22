import type { Route } from '@playwright/test';
import { expect, test } from './base';
import { openMenu } from './helpers';

/**
 * The room screen is rebuilt on every change (the session's state, the Wi-Fi invite address
 * arriving from /network-info). A rebuild must keep what the player is typing: the text, the
 * focus and the selection. Typing over a selected name just as the screen redraws once produced
 * "DriverHost" instead of "Host" (Playwright's fill selects, then types, in two steps).
 */
test('a lobby redraw keeps the selection in the name field', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'menus only, one project');
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/network-info', async (route: Route) => {
    await held;
    await route.continue();
  });
  await page.goto('/?debug=1&quality=lite');
  await openMenu(page);
  await page.locator('[data-action=mode-online]').click();
  await page.locator('[data-action=start]').click();
  const name = page.getByLabel('Driver name');
  await expect(name).toHaveValue('Driver');
  await name.selectText();
  await name.evaluate((i) => i.setAttribute('data-before-redraw', ''));
  // The invite addresses arrive: the screen redraws with the selection in place.
  release();
  await expect(page.locator('[data-before-redraw]')).toHaveCount(0);
  await expect(name).toBeFocused();
  await page.keyboard.insertText('Host');
  await expect(name).toHaveValue('Host');
});
