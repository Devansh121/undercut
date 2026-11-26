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

for (const device of ['keyboard', 'gamepad'] as const) {
  test(`online controls remain reachable with ${device}`, async ({ page }, info) => {
    test.skip(!['desktop', 'phone'].includes(info.project.name), 'the two target viewports');
    if (device === 'gamepad') {
      await page.addInitScript(() => {
        const pad = {
          index: 0,
          id: 'Room test pad',
          connected: true,
          mapping: 'standard',
          timestamp: 0,
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        };
        Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
        (window as unknown as { roomPad: typeof pad }).roomPad = pad;
      });
    }
    await page.goto('/?debug=1&quality=lite');
    await openMenu(page);
    await page.locator('[data-action=mode-online]').click();
    await page.locator('[data-action=start]').click();
    await page.screenshot({ path: info.outputPath('entry.png') });
    const frame = () =>
      page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    const press = async (direction: string): Promise<void> => {
      if (device === 'keyboard') {
        await page.keyboard.press(direction);
        await frame();
      } else {
        const index = {
          ArrowUp: 12,
          ArrowDown: 13,
          ArrowLeft: 14,
          ArrowRight: 15,
          Enter: 0,
          Escape: 1,
        }[direction]!;
        await page.evaluate(async (i) => {
          const pad = (
            window as unknown as {
              roomPad: { buttons: { pressed: boolean; touched: boolean; value: number }[] };
            }
          ).roomPad;
          const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
          pad.buttons[i] = { pressed: true, touched: true, value: 1 };
          await raf();
          pad.buttons[i] = { pressed: false, touched: false, value: 0 };
          await raf();
        }, index);
      }
    };
    const explore = async (): Promise<void> => {
      const ids = await page
        .locator('.online-screen [data-nav]:not(:disabled)')
        .evaluateAll((nodes) => nodes.map((n) => n.id));
      expect(ids.every(Boolean)).toBe(true);
      const initial = await page.evaluate(() => document.activeElement?.id ?? '');
      const reached = new Set([initial]);
      const queue = [initial];
      while (queue.length && reached.size < ids.length) {
        const from = queue.shift()!;
        for (const direction of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
          // Numeric fields consume horizontal input as editing, rather than navigation.
          if (
            ['online-laps', 'online-ai-cars'].includes(from) &&
            ['ArrowLeft', 'ArrowRight'].includes(direction)
          )
            continue;
          await page.locator(`[id="${from}"]`).focus();
          await press(direction);
          const next = await page.evaluate(() => document.activeElement?.id ?? '');
          expect(ids).toContain(next);
          if (!reached.has(next)) {
            reached.add(next);
            queue.push(next);
          }
        }
      }
      expect([...reached].sort()).toEqual([...ids].sort());
    };
    await explore();
    await page.getByLabel('Driver name').fill('Alex Rivers');
    await page.getByRole('button', { name: 'Create room', exact: true }).focus();
    await press('Enter');
    await expect(page.getByTestId('invite')).toBeVisible();
    await expect(page.locator('.online-members')).toContainText('Alex Rivers');
    await expect(page.locator('.online-members')).toContainText('You · Host');
    await expect(page.locator('.online-members')).not.toContainText('ASH');
    await expect(page.locator('#online-abs-true')).toHaveAttribute('aria-checked', 'true');
    await explore();
    await page.locator('#online-laps').focus();
    if (device === 'gamepad') {
      await press('ArrowLeft');
      await expect(page.getByLabel('Laps', { exact: true })).toHaveValue('4');
      await expect(page.getByLabel('Laps', { exact: true })).toBeFocused();
    }
    await page.locator('#online-circuit-spa').focus();
    await press('Enter');
    await expect(page.locator('#online-circuit-spa')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#online-circuit-spa')).toBeFocused();
    await page.locator('#online-abs-false').focus();
    await press('Enter');
    await expect(page.locator('#online-abs-false')).toHaveAttribute('aria-checked', 'true');
    await page.locator('.online-screen__content').evaluate((n) => {
      n.scrollTop = n.scrollHeight;
    });
    const ready = page.getByRole('button', { name: 'Ready to start', exact: true });
    await expect(ready).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Leave room', exact: true })).toBeInViewport();
    const overflow = await page
      .locator('.online-screen__content')
      .evaluate((n) => n.scrollWidth - n.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.locator('.online-screen__content').evaluate((n) => {
      n.scrollTop = 0;
    });
    await page.screenshot({ path: info.outputPath('room.png') });
    await press('Escape');
    await expect(page.getByLabel('Driver name')).toBeVisible();
  });
}
