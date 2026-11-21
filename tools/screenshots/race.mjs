// Capture a moving Quick Race and start-grid frame times on the shared GPU.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

if (!process.env.RACE_GPU_LOCKED) {
  const result = spawnSync(
    'flock',
    [
      path.join(os.homedir(), '.cache/undercut/gpu.lock'),
      process.execPath,
      fileURLToPath(import.meta.url),
    ],
    { stdio: 'inherit', env: { ...process.env, RACE_GPU_LOCKED: '1' } },
  );
  process.exit(result.status ?? 1);
}
const out = 'docs/evidence/m3-quick-race';
fs.mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, ['tools/serve/start.mjs'], {
  env: { ...process.env, PORT: '4473', HTTPS_PORT: '4474', ROOMS_PORT: '4987' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (d) => (output += d));
server.stderr.on('data', (d) => (output += d));
let browser;
const report = [];
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4473/rooms/health')).ok) break;
    } catch {
      /* Starting. */
    }
    if (server.exitCode !== null) throw new Error(output);
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=gl-egl',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
    ],
  });
  for (const [name, width, height, quality] of [
    ['desktop', 1920, 1080, 'high'],
    ['phone', 844, 390, 'mobile'],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`http://127.0.0.1:4473/?debug=1&quality=${quality}`);
    await page.waitForFunction(() => !!globalThis.__undercut);
    // Standing grid from P20 so all twenty cars sit in view for the grid shot and frame-time check.
    await page.evaluate(() => globalThis.__undercut.startQuickRace(5, { gridPosition: 20 }));
    await page.evaluate(() => {
      globalThis.__undercut.setTimeScale(0);
      globalThis.__undercut.camera('chase-far');
    });
    await page.screenshot({ path: `${out}/${name}-grid-chase.jpg`, type: 'jpeg', quality: 90 });
    await page.evaluate(() => {
      globalThis.__undercut.resetFrameTimes();
      globalThis.__undercut.setTimeScale(1);
    });
    await page.waitForTimeout(3000);
    report.push(
      await page.evaluate(
        ({ name, quality }) => {
          const a = globalThis.__undercut.frameTimes().sort((a, b) => a - b);
          return {
            name,
            quality,
            grid: true,
            frames: a.length,
            medianMs: a[Math.floor(a.length / 2)],
            p95Ms: a[Math.floor(a.length * 0.95)],
            stats: globalThis.__undercut.renderStats(),
          };
        },
        { name, quality },
      ),
    );
    // Restart in the midfield (P10) for turn-one and mid-race pack captures.
    await page.evaluate(() => globalThis.__undercut.startQuickRace(5, { gridPosition: 10 }));
    await page.evaluate(() => {
      globalThis.__undercut.autopilot(true);
      globalThis.__undercut.setTimeScale(4);
    });
    for (const stage of ['turn-one', 'pack']) {
      if (stage === 'turn-one') {
        // Braking into the first chicane on lap 1.
        await page.waitForFunction(
          () => {
            const s = Number(globalThis.__undercut.state().s);
            return s > 500 && s < 600;
          },
          null,
          { timeout: 120_000 },
        );
      } else {
        // Mid-race: lap 2 or later with at least six cars within 120 m of the player.
        await page.waitForFunction(
          () => {
            const st = globalThis.__undercut.state();
            return Number(st.lap) >= 2 && Number(st.nearby) >= 6;
          },
          null,
          { timeout: 300_000, polling: 100 },
        );
      }
      await page.evaluate(() => {
        globalThis.__undercut.setTimeScale(0);
        globalThis.__undercut.camera('chase-far');
      });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${out}/${name}-${stage}-chase.jpg`,
        type: 'jpeg',
        quality: 90,
      });
      await page.evaluate(() => {
        const u = globalThis.__undercut,
          s = Number(u.state().s);
        // Ahead of the player, looking back down the track at the cars behind it.
        const eye = u.trackPoint(s + 60, 16, 5),
          aim = u.trackPoint(s - 30, 0, 0.5);
        u.tvCamera(eye.x, eye.y, eye.z, 42, aim);
      });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${out}/${name}-${stage}-trackside.jpg`,
        type: 'jpeg',
        quality: 90,
      });
      await page.evaluate(() => {
        globalThis.__undercut.camera('chase-far');
        globalThis.__undercut.setTimeScale(4);
      });
    }
    await page.close();
  }
  fs.writeFileSync(`${out}/performance.json`, JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const done = new Promise((r) => server.once('exit', r));
    server.kill('SIGTERM');
    await done;
  }
}
