import { expect, test } from './base';

test('Quick Race: grid, lights, moving field and player result', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?debug=1&quality=lite');
  await page.waitForFunction(() => !!window.__undercut);
  await page.evaluate(() => window.__undercut!.startQuickRace(1));
  expect(await page.evaluate(() => window.__undercut!.state().cars)).toBe(20);
  expect(await page.evaluate(() => window.__undercut!.state().racePhase)).toBe('grid');
  await page.evaluate(() => {
    window.__undercut!.autopilot(true);
    window.__undercut!.setTimeScale(8);
  });
  await page.waitForFunction(() => window.__undercut!.state().racePhase === 'green', null, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('race-status')).toContainText('/ 20');
  await page.waitForFunction(() => Number(window.__undercut!.telemetry().speed) > 10);
  await page.waitForFunction(() => !!window.__undercut!.state().raceResult, null, {
    timeout: 120_000,
  });
  await expect(page.getByTestId('race-status')).toContainText('Race result');
  await page.evaluate(() => window.__undercut!.quit());
});
