import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './base';
import { openMenu, startTimeTrial, watchProblems } from './helpers';

const capture = async (page: Page, name: string) => {
  if (!process.env.RACE_EVIDENCE) return;
  await mkdir(process.env.RACE_EVIDENCE, { recursive: true });
  await page.screenshot({
    path: `${process.env.RACE_EVIDENCE}/${test.info().project.name}-${name}.png`,
  });
};

test('race distance has a label, value and reachable options in every race mode', async ({
  page,
}, info) => {
  await page.goto('/?debug=1&quality=lite&world=lite');
  await openMenu(page);
  const phone = info.project.name === 'phone';
  // The distance reads in the summary: the card on a phone, the action bar on a desktop.
  const summary = page.locator(phone ? '.settings-summary__vals' : '.actionbar__summary');
  for (const mode of ['quickRace', 'weekend', 'championship']) {
    await page.locator(`[data-action=mode-${mode}]`).click();
    await expect(summary).toContainText('5 laps');
    if (phone) {
      await page.locator('[data-action=edit-settings]').tap();
    } else {
      await expect(page.locator('.settings [data-setting=raceLaps]')).toBeVisible();
      await expect(page.locator('.settings .race-distance-setting')).toContainText('Race distance');
      await expect(
        page.locator('.settings [data-setting=raceLaps] [aria-checked=true]'),
      ).toHaveText('5 laps');
      const options = page.locator('[data-action=edit-race-settings]');
      await expect(options).toHaveText('Race options');
      await options.focus();
      await page.keyboard.press('Enter');
    }
    const dialog = page.getByTestId('settings-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-setting=raceLaps]')).toBeVisible();
    await expect(dialog.locator('[data-setting=automaticPitLimiter]')).toBeVisible();
    await dialog.locator('[data-setting=raceLaps] [data-value="15"]').click();
    await expect(summary).toContainText('15 laps');
    await dialog.locator('[data-setting=raceLaps] [data-value="5"]').click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
  await capture(page, 'race-options');
});

test('Time Trial shows fresh reference soft tyres in their working window', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchProblems(page);
  await page.goto('/?debug=1&quality=lite&world=lite');
  await startTimeTrial(page);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  const tyres = page.locator(
    '[data-testid=hud-tyres]:visible, [data-testid=hud-mini-tyres]:visible',
  );
  await expect(tyres).toHaveCount(1);
  await expect(tyres.locator('[data-band]')).toHaveCount(4);
  for (const tread of await tyres.locator('[data-band]').all()) {
    await expect(tread).toHaveAttribute('data-band', 'ok');
  }
  await expect(tyres).not.toContainText(/no data/i);
  await expect(tyres).toContainText('S');
  await capture(page, 'reference-tyres');
  expect(problems).toEqual([]);
});
