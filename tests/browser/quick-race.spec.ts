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
  // A reset in a race parks the car stopped at the edge, off the racing line, not on it in
  // front of the field.
  const parked = await page.evaluate(() => {
    const u = window.__undercut!;
    u.resetToTrack();
    return { d: Number(u.state().d), speed: Number(u.telemetry().speed) };
  });
  expect(Math.abs(parked.d)).toBeGreaterThan(3);
  expect(Math.abs(parked.speed)).toBeLessThan(1);
  // The pause menu restarts the race, not a lap.
  await page.evaluate(() => window.__undercut!.pause());
  await expect(page.locator('.pause__action[data-action="restart"]')).toHaveText('Restart race');
  await page.evaluate(() => window.__undercut!.resume());
  // After the player's flag the standings are provisional until the field has finished.
  await page.waitForFunction(() => window.__undercut!.state().provisional === true, null, {
    timeout: 120_000,
  });
  expect(await page.evaluate(() => window.__undercut!.state().raceResult)).toBeNull();
  await page.waitForFunction(() => !!window.__undercut!.state().raceResult, null, {
    timeout: 120_000,
  });
  await expect(page.getByTestId('race-status')).toContainText('Race result');
  await page.evaluate(() => window.__undercut!.quit());
});
