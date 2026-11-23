import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from './base';
import { startQuickRace } from './helpers';

/**
 * The audio worklet's processing time in the game itself, not in an isolated context: a muted
 * Quick Race at Monza on the Mobile preset with its full world, nineteen AI cars and the
 * player's car on autopilot, for about 75 s of real time. The processor sums `Date.now()`
 * around each block and reports every 4096 blocks; the figure is the share of audio time spent
 * processing, from the first report to the last (start-up excluded). Opt-in, outside CI:
 * `AUDIO_PROFILE=1 npx playwright test tests/browser/audio-cost.spec.ts --project=phone`.
 * Writes artifacts/audio/worklet-in-game.json.
 */
test('audio worklet cost in a Mobile Quick Race', async ({ page }, info) => {
  test.skip(!process.env.AUDIO_PROFILE, 'opt-in measurement (AUDIO_PROFILE=1)');
  test.skip(info.project.name !== 'phone', 'measured on the phone project');
  test.setTimeout(180_000);
  await page.goto('/?debug=1&quality=mobile&audioProfile=1');
  await page.waitForFunction(() => !!window.__undercut);
  await startQuickRace(page);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 90_000 });
  await page.evaluate(() => window.__undercut!.autopilot(true));
  const reports: Record<string, number | string>[] = [];
  const end = Date.now() + 75_000;
  while (Date.now() < end) {
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => window.__undercut!.audioProfile());
    if (r && reports.at(-1)?.blocks !== r.blocks) reports.push(r);
  }
  expect(reports.length, 'profile reports').toBeGreaterThanOrEqual(3);
  const first = reports[0]!;
  const last = reports.at(-1)!;
  const windows = reports.slice(1).map((r, i) => {
    const p = reports[i]!;
    return (
      (100 * (Number(r.processMs) - Number(p.processMs))) / (Number(r.audioMs) - Number(p.audioMs))
    );
  });
  const result = {
    preset: 'mobile',
    viewport: '844x390 (phone project), full Monza world, 19 AI cars, autopilot',
    audibleCars: last.audibleCars,
    fieldLevel: last.fieldLevel,
    audioSeconds: (Number(last.audioMs) - Number(first.audioMs)) / 1000,
    cpuPercent:
      (100 * (Number(last.processMs) - Number(first.processMs))) /
      (Number(last.audioMs) - Number(first.audioMs)),
    windowPercents: windows,
    clock: last.clock,
  };
  mkdirSync('artifacts/audio', { recursive: true });
  writeFileSync('artifacts/audio/worklet-in-game.json', JSON.stringify(result, null, 2) + '\n');
  expect(result.cpuPercent).toBeLessThan(10);
  await page.evaluate(() => window.__undercut!.quit());
});
