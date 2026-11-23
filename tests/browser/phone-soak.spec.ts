import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from './base';

/**
 * A sustained run on the emulated Pixel 8: a Mobile-preset Quick Race at Monza with its full
 * world and nineteen AI cars, the player's car on its racing driver, sound on with the worklet
 * measuring itself, for SOAK_MINUTES (default 10) of real time. Each minute it records the frame
 * times of that minute, the JavaScript heap after a forced garbage collection, the renderer's
 * live geometries, textures and programs, and the worklet's share of audio time. What it looks
 * for is drift: frame times or heap that climb minute on minute, or GPU objects that pile up.
 *
 * Software WebGL on a shared laptop sets the absolute frame rate, so the numbers are compared
 * with the run's own first minutes, not with a phone. Opt-in, outside CI, one at a time:
 *   PHONE_SOAK=1 npx playwright test tests/browser/phone-soak.spec.ts --project=pixel-phone
 * Writes artifacts/phone/soak.json.
 */
const MINUTES = Number(process.env.SOAK_MINUTES ?? 10);

const pct = (sorted: number[], p: number): number =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

test('sustained Mobile Quick Race on a phone: frame-time drift, heap growth, audio cost', async ({
  page,
}, info) => {
  test.skip(!process.env.PHONE_SOAK, 'opt-in measurement (PHONE_SOAK=1)');
  test.skip(info.project.name !== 'pixel-phone', 'measured on the Pixel 8 project');
  test.setTimeout((MINUTES + 4) * 60_000);
  const cdp = await page.context().newCDPSession(page);
  await page.goto('/?debug=1&quality=mobile&audioProfile=1');
  await page.waitForFunction(() => !!window.__undercut);
  // A tap first: the gesture that lets sound start.
  await page.locator('[data-action=press-start]').tap();
  await page.evaluate(() => window.__undercut!.startQuickRace(40));
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 120_000 });
  await page.evaluate(() => window.__undercut!.raceDriver(true));

  const heap = async (): Promise<number> => {
    await cdp.send('HeapProfiler.collectGarbage');
    const r = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
    return r.usedSize;
  };

  const minutes: Record<string, unknown>[] = [];
  await page.evaluate(() => window.__undercut!.resetFrameTimes());
  for (let m = 1; m <= MINUTES; m++) {
    await page.waitForTimeout(60_000);
    const sample = await page.evaluate(() => {
      const u = window.__undercut!;
      const frames = u.frameTimes();
      u.resetFrameTimes();
      return {
        frames,
        renderer: u.rendererInfo(),
        audio: u.audioProfile(),
        audioStatus: u.audioStatus(),
        state: u.state(),
      };
    });
    const sorted = [...sample.frames].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
    const row = {
      minute: m,
      frames: sorted.length,
      meanMs: +mean.toFixed(2),
      p50Ms: +pct(sorted, 0.5).toFixed(2),
      p95Ms: +pct(sorted, 0.95).toFixed(2),
      p99Ms: +pct(sorted, 0.99).toFixed(2),
      over50Ms: sorted.filter((f) => f > 50).length,
      heapMB: +((await heap()) / 2 ** 20).toFixed(2),
      renderer: sample.renderer,
      audio: sample.audio,
      audioStatus: sample.audioStatus,
      lap: (sample.state as { lap?: number }).lap,
    };
    minutes.push(row);
    console.log(JSON.stringify({ ...row, renderer: undefined, audio: undefined }));
  }

  // Worklet share of audio time over the whole run, from the first and last reports.
  const reports = minutes
    .map((m) => m.audio as Record<string, number> | null)
    .filter((r): r is Record<string, number> => !!r);
  const first = reports[0];
  const last = reports.at(-1);
  const audioCpuPercent =
    first && last && last.audioMs! > first.audioMs!
      ? (100 * (last.processMs! - first.processMs!)) / (last.audioMs! - first.audioMs!)
      : null;

  // Drift: the last three minutes against minutes two to four (minute one includes warm-up).
  const avg = (rows: Record<string, unknown>[], key: string): number =>
    rows.reduce((a, r) => a + Number(r[key]), 0) / rows.length;
  const early = minutes.slice(1, 4);
  const late = minutes.slice(-3);
  const result = {
    device: 'Pixel 8 emulation (Chromium, 915x412 at 2.625, touch), software WebGL',
    preset: 'mobile',
    scene: 'Quick Race at Monza, full world, 19 AI cars, player on its racing driver, sound on',
    minutes: MINUTES,
    drift: {
      meanMs: { early: +avg(early, 'meanMs').toFixed(2), late: +avg(late, 'meanMs').toFixed(2) },
      p95Ms: { early: +avg(early, 'p95Ms').toFixed(2), late: +avg(late, 'p95Ms').toFixed(2) },
      heapMB: {
        early: +avg(early, 'heapMB').toFixed(2),
        late: +avg(late, 'heapMB').toFixed(2),
      },
    },
    audioCpuPercent,
    rows: minutes,
  };
  mkdirSync('artifacts/phone', { recursive: true });
  writeFileSync('artifacts/phone/soak.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, rows: undefined }));
  await page.evaluate(() => window.__undercut!.quit());

  // No real leak and no slowdown over the run. The bounds are generous for software WebGL on
  // a shared machine; a leak or a pile-up shows as far more.
  expect(result.drift.heapMB.late).toBeLessThan(result.drift.heapMB.early * 1.15 + 4);
  expect(result.drift.meanMs.late).toBeLessThan(result.drift.meanMs.early * 1.25);
  const r0 = minutes[1]!.renderer as Record<string, number>;
  const r1 = minutes.at(-1)!.renderer as Record<string, number>;
  for (const key of ['geometries', 'textures', 'programs'])
    if (key in r0) expect(r1[key], key).toBeLessThanOrEqual(r0[key]! + 8);
});
