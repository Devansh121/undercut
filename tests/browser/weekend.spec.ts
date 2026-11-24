import { expect, test } from './base';
import { DESKTOP, PHONES, fitEverywhere } from './fit-sweep';
import { openMenu } from './helpers';

test('weekend: practice (simulated to the flag on desktop, skipped on a phone), qualifying result, continue to the mandatory-stop race; player pit call and service', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await page.goto('/?debug=1&quality=lite&world=lite&weekendDuration=0.1&practiceDuration=12');
  await openMenu(page);
  await page.locator('[data-action=mode-weekend]').click();
  await page.locator('[data-action=start]').click();
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'weekend');
  await page.screenshot({ path: info.outputPath('weekend.png') });
  // Each weekend screen is held to the layout and text-fit rules at every size and text size,
  // where the flow already reaches it (no extra loads): the phone sizes, or 1440 x 900.
  const sizes = info.project.name === 'phone' ? PHONES : DESKTOP;
  const fit = (label: string): Promise<string[]> => fitEverywhere(page, { label, sizes });
  expect(await fit('weekend screen')).toEqual([]);
  if (info.project.name === 'phone') {
    await page.locator('[data-action=skip-practice]').click();
  } else {
    // Practice: back to the box and the rest of the session simulated.
    await expect(page.locator('[data-action=weekend-start]')).toHaveText('Start Practice');
    await page.locator('[data-action=weekend-start]').click();
    await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
    await page.getByTestId('simulate-session').click({ timeout: 30_000 });
    // The button gives way to the progress module (unless the session is already over).
    await expect(page.getByTestId('simulate-session')).toBeHidden();
    await expect(page.getByTestId('continue-weekend')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('simulate-progress')).toBeHidden();
    await expect(page.getByTestId('race-status')).toContainText('Practice result');
    await expect(page.getByTestId('race-status').locator('th')).toHaveText([
      'Pos',
      'Driver',
      'Best lap',
      'Gap',
      'Laps',
    ]);
    await expect(page.getByTestId('race-status').locator('tbody tr')).toHaveCount(20);
    await page.screenshot({ path: info.outputPath('practice-result.png') });
    await page.getByTestId('continue-weekend').click();
    await expect(page.locator('.weekend-table caption')).toHaveText('Practice classification');
  }
  await expect(page.locator('[data-action=weekend-start]')).toHaveText('Start Qualifying');
  await page.locator('[data-action=weekend-start]').click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await page.evaluate(() => window.__undercut!.setTimeScale(8));
  await expect(page.getByTestId('continue-weekend')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('race-status')).toContainText('Qualifying result');
  await expect(page.locator('[data-testid=race-status][data-table]')).toBeVisible();
  expect(await fit('qualifying result')).toEqual([]);
  await page.getByTestId('continue-weekend').click();
  expect(await page.evaluate(() => window.__undercut!.state().screen)).toBe('launch');
  await expect(page.locator('[data-action=weekend-start]')).toHaveText('Start Race');
  await expect(page.locator('.weekend-table').first()).toBeVisible();
  expect(await fit('weekend classification')).toEqual([]);
  await page.locator('[data-action=weekend-start]').click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  expect(await page.evaluate(() => window.__undercut!.state().twoCompoundRule)).toBe(true);
  await page.evaluate(() => {
    window.__undercut!.raceDriver(true);
    window.__undercut!.setTimeScale(8);
  });
  await page.waitForFunction(() => window.__undercut!.state().racePhase === 'green');
  // A scripted approach starts clear of the field, then follows real steering inputs into the lane.
  await page.evaluate(() => {
    window.__undercut!.setTimeScale(0);
    window.__undercut!.teleport(5125.675, 0, 108);
    const panel = document.querySelector<HTMLElement>('[data-testid=pit-panel]')!;
    new MutationObserver(() => {
      if (/Pit service · [0-9]+\.[0-9] s/.test(panel.textContent ?? ''))
        panel.dataset.sawService = 'true';
    }).observe(panel, { subtree: true, childList: true, characterData: true });
  });
  // The race HUD with its pit panel, the clock stopped while the sizes change.
  await expect(page.getByTestId('pit-panel')).toBeVisible();
  expect(await fit('race with pit panel')).toEqual([]);
  await page.evaluate(() => {
    window.__undercut!.setTimeScale(0);
    window.__undercut!.teleport(5125.675, 0, 108);
  });
  if (info.project.name === 'phone') {
    await page.evaluate(() => window.__undercut!.setTimeScale(1));
    await page.locator('.ut-touch__btn--boxThisLap').tap();
  } else await page.getByTestId('box-this-lap').click();
  await expect(page.getByTestId('box-this-lap').locator('.btn__label')).toHaveText(
    'Cancel pit call',
  );
  if (info.project.name === 'phone') await page.locator('.ut-touch__btn--boxThisLap').tap();
  else await page.getByTestId('box-this-lap').click();
  await expect(page.getByTestId('box-this-lap').locator('.btn__label')).toHaveText('Box this lap');
  await page.evaluate(() => {
    window.__undercut!.setTimeScale(0);
    window.__undercut!.teleport(5125.675, 0, 108);
  });
  // Keyboard binding reaches the same request; touch and gamepad bindings are covered headless.
  await page.keyboard.press('i');
  await page.evaluate(() => window.__undercut!.setTimeScale(8));
  await expect(page.getByTestId('pit-panel')).toContainText('Box confirmed');
  await page.waitForFunction(() => Number(window.__undercut!.state().pitStops) === 1, null, {
    timeout: 50_000,
  });
  await expect(page.getByTestId('pit-panel')).toContainText('1 stop');
  await expect(page.getByTestId('pit-panel')).toHaveAttribute('data-saw-service', 'true');
  await page.waitForFunction(() => window.__undercut!.state().pitPhase === 'none', null, {
    timeout: 30_000,
  });
  await page.screenshot({ path: info.outputPath('pit-release.png') });
  expect(await page.evaluate(() => window.__undercut!.state().compounds)).toEqual([
    'medium',
    'hard',
  ]);
  await page.evaluate(() => window.__undercut!.quit());
});
