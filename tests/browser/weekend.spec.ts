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
  await page.evaluate(() => window.__undercut!.teleport(5125.675, 0, 108));
  await page.getByTestId('box-this-lap').click();
  await expect(page.getByTestId('box-this-lap')).toHaveText('Cancel pit call');
  await page.getByTestId('box-this-lap').click();
  await expect(page.getByTestId('box-this-lap')).toHaveText('Box this lap');
  // Keyboard binding reaches the same request; touch and gamepad bindings are covered headless.
  await page.keyboard.press('i');
  await expect(page.getByTestId('pit-panel')).toContainText('Box confirmed');
  await page.waitForFunction(() => Number(window.__undercut!.state().pitStops) === 1, null, {
    timeout: 50_000,
  });
  await expect(page.getByTestId('pit-panel')).toContainText('1 stops');
  await page.waitForFunction(() => window.__undercut!.state().pitPhase === 'none', null, {
    timeout: 30_000,
  });
  expect(await page.evaluate(() => window.__undercut!.state().compounds)).toEqual([
    'medium',
    'hard',
  ]);
  await page.evaluate(() => window.__undercut!.quit());
});
