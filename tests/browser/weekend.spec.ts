import { expect, test } from './base';
import { openMenu } from './helpers';

test('weekend: skip practice, qualifying result, continue to the mandatory-stop race; player pit call and service', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  await page.goto('/?debug=1&quality=lite&world=lite&weekendDuration=0.1');
  await openMenu(page);
  await page.locator('[data-action=mode-weekend]').click();
  await page.locator('[data-action=start]').click();
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'weekend');
  await page.screenshot({ path: info.outputPath('weekend.png') });
  await page.locator('[data-action=skip-practice]').click();
  await expect(page.locator('[data-action=weekend-start]')).toHaveText('Start qualifying');
  await page.locator('[data-action=weekend-start]').click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await page.evaluate(() => window.__undercut!.setTimeScale(8));
  await expect(page.getByTestId('continue-weekend')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('race-status')).toContainText('Qualifying result');
  await page.getByTestId('continue-weekend').click();
  expect(await page.evaluate(() => window.__undercut!.state().screen)).toBe('launch');
  await expect(page.locator('[data-action=weekend-start]')).toHaveText('Start race');
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
  if (info.project.name === 'phone') {
    await page.evaluate(() => window.__undercut!.setTimeScale(1));
    await page.locator('.ut-touch__btn--boxThisLap').tap();
  } else await page.getByTestId('box-this-lap').click();
  await expect(page.getByTestId('box-this-lap')).toHaveText('Cancel pit call');
  if (info.project.name === 'phone') await page.locator('.ut-touch__btn--boxThisLap').tap();
  else await page.getByTestId('box-this-lap').click();
  await expect(page.getByTestId('box-this-lap')).toHaveText('Box this lap');
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
