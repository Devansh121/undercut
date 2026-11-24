import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openMenu } from './helpers';
import { DESKTOP, PHONES, layoutProblems, setTextSize } from './fit-sweep';
import { textFitProblems } from './text-fit';

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

  // Esc on the keyboard cancels a controller rebinding (it does not wait out the 5 s), and the
  // next pad press is not taken as the binding.
  await slot(page, 'nextCamera', 0).focus();
  await tap(0);
  await expect(slot(page, 'nextCamera', 0)).toHaveText('Press a button');
  await page.keyboard.press('Escape');
  await expect(slot(page, 'nextCamera', 0).locator('.glyph')).toHaveText('B');
  await expect(page.locator('.settings__notice')).toHaveText('No change.');
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'settings');
  // So does a click outside the slots.
  await tap(0);
  await expect(slot(page, 'nextCamera', 0)).toHaveText('Press a button');
  await page.locator('.settings-screen__body').click({ position: { x: 4, y: 4 } });
  await expect(slot(page, 'nextCamera', 0).locator('.glyph')).toHaveText('B');

  // RB steps to the next section and puts focus on its first control; LB back.
  await tap(5);
  await expect(page.locator('.settings-screen__tabs [data-tab=assists]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    await page.evaluate(
      () => document.activeElement?.closest('[data-section]')?.getAttribute('data-section') ?? null,
    ),
  ).toBe('assists');
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
  // Vibration (the pause menu's setting too) is under Controls.
  await page.locator('.settings-screen__tabs [data-tab=controls]').click();
  await page.locator('[data-setting=haptics]').click();
  await expect(page.locator('[data-setting=haptics]')).toHaveAttribute('aria-checked', 'false');

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
  await page.locator('.settings-screen__tabs [data-tab=controls]').click();
  await expect(page.locator('[data-setting=haptics]')).toHaveAttribute('aria-checked', 'false');

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

test('on a wide screen, Up and Down from the top bar and the action bar reach the section', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop', 'the wide layout');
  await page.goto('/?quality=lite');
  await openMenu(page);
  await openSettings(page);
  /** Where focus is: the tab strip, the section pane, or elsewhere. */
  const where = (): Promise<string> =>
    page.evaluate(() => {
      const a = document.activeElement;
      if (a?.closest('.settings-screen__tabs')) return 'tabs';
      if (a?.closest('[data-section]')) return 'pane';
      return a?.closest('.shell__top') ? 'top' : 'other';
    });
  const inPane = (): Promise<string | null> =>
    page.evaluate(
      () => document.activeElement?.closest('[data-section]')?.getAttribute('data-section') ?? null,
    );
  for (const section of ['controls', 'assists', 'accessibility', 'display', 'audio', 'graphics']) {
    await page.locator(`.settings-screen__tabs [data-tab=${section}]`).click();
    await page.locator('.shell__top [data-action=controls]').focus();
    // Down from the top bar may stop on the section tabs first (they sit between); the next
    // Down enters the section. It never skips to the action bar. (The menu loop reads the key on
    // its next frame: poll.)
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(where, { message: `Down from the top bar, ${section}` })
      .toMatch(/^(tabs|pane)/);
    if ((await where()).startsWith('tabs')) await page.keyboard.press('ArrowDown');
    await expect.poll(inPane, { message: `Down from the top bar, ${section}` }).toBe(section);
    await page.locator('[data-testid=settings] [data-action=credits]').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(inPane, { message: `Up from Credits, ${section}` }).toBe(section);
  }
});

test('the HUD and the pause card keep their text inside at every size and text size', async ({
  drive: { page },
}) => {
  const project = test.info().project.name;
  test.skip(project !== 'phone' && project !== 'desktop', 'one phone and one desktop engine');
  const sizes = project === 'phone' ? PHONES : DESKTOP;
  const before = page.viewportSize();
  const menu = page.locator('[data-testid=pause-menu]');
  const problems: string[] = [];
  try {
    for (const size of sizes) {
      await page.setViewportSize(size);
      for (const text of ['standard', 'large', 'larger']) {
        await setTextSize(page, text);
        const at = `${size.width} x ${size.height}, ${text} text`;
        // The HUD: every piece of text in its box, and in the timing tower the name never runs
        // into the time (two texts in one row: the row is their box, so check them apart).
        const targets = project === 'phone';
        problems.push(...(await page.evaluate(layoutProblems, { label: `${at}, HUD`, targets })));
        for (const p of await page.evaluate(textFitProblems, '#app'))
          problems.push(`${at}, HUD: ${p}`);
        // Upright, the session pauses itself behind the rotate prompt (phone-session.ts) and
        // stays paused; on its side, Esc opens and closes the card, and the tower is on screen.
        const upright = size.height > size.width;
        for (const p of await page.evaluate(towerOverlaps, !upright))
          problems.push(`${at}, HUD: ${p}`);
        if (!(await menu.isVisible())) await page.keyboard.press('Escape');
        await expect(menu).toBeVisible();
        problems.push(...(await page.evaluate(layoutProblems, { label: `${at}, pause`, targets })));
        for (const p of await page.evaluate(textFitProblems, '[data-testid=pause-menu]'))
          problems.push(`${at}, pause: ${p}`);
        if (!upright) {
          await page.keyboard.press('Escape');
          await expect(menu).toBeHidden();
        }
      }
    }
  } finally {
    await page.evaluate(() => delete document.documentElement.dataset.text);
    if (before) await page.setViewportSize(before);
    if (await menu.isVisible()) await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
  expect(problems).toEqual([]);
});

/**
 * Timing tower rows where the driver code's text reaches the time's (in the page). `expectRows`:
 * the tower is on screen, so finding no rows is itself a failure (not a silent pass).
 */
function towerOverlaps(expectRows: boolean): string[] {
  const out: string[] = [];
  const rows = [...document.querySelectorAll('.hud-tower__row')].filter(
    (r) => r.getClientRects().length > 0,
  );
  if (expectRows && rows.length === 0) out.push('no tower rows');
  const ink = (row: Element, sel: string): DOMRect | undefined => {
    const el = row.querySelector(sel);
    if (!el) return undefined;
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  };
  for (const row of rows) {
    const code = ink(row, '.hud-tower__code');
    const time = ink(row, '.hud-tower__time');
    if (code && time && code.width > 0 && time.width > 0 && code.right > time.left + 0.5)
      out.push(`tower: "${row.textContent ?? ''}" name runs into time`);
  }
  return out;
}
