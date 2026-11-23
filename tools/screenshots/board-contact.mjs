// GPU evidence at the second chicane's left verge, beside the screen and catch fence.
// timeout 900 flock ~/.cache/undercut/gpu.lock node tools/screenshots/board-contact.mjs <out> [before]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const port = Number(process.env.SHOTS_PORT ?? 4493);
if (port === 6151) throw new Error('reserved capture port');
const server = spawn(process.execPath, ['tools/serve/start.mjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    HTTPS_PORT: String(port + 1),
    ROOMS_PORT: String(port + 514),
  },
  stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
    } catch {
      /* server starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  browser = await chromium.launch({
    args: [
      '--mute-audio',
      '--use-gl=angle',
      '--use-angle=gl-egl',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(`http://127.0.0.1:${port}/?debug=1&quality=high`);
  await page.waitForFunction(() => Boolean(globalThis.__undercut));
  await page.evaluate(() => globalThis.__undercut.start());
  await page.waitForFunction(
    () => globalThis.document.documentElement.dataset.ready !== undefined,
    null,
    {
      timeout: 90000,
    },
  );
  await page.evaluate(() => {
    const u = globalThis.__undercut;
    u.setTimeScale(0);
    u.camera('tcam');
    u.setHudVisible(false);
    globalThis.document.querySelectorAll('.onboarding').forEach((el) => el.remove());
  });
  if (process.argv.includes('before')) {
    for (const s of [1792, 1800, 1820, 1840]) {
      await page.evaluate((s) => {
        const u = globalThis.__undercut;
        u.teleport(s, u.trackPoint(s).left + 2.7, 0);
      }, s);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `before-${s}.png`) });
    }
  } else {
    await page.evaluate(() => {
      const u = globalThis.__undercut;
      const objects = u.view().props.breakableObjects;
      const b = [...objects.values()].filter(
        (o) =>
          Math.hypot(
            o.x - u.trackPoint(1800, u.trackPoint(1800).left + 2.7).x,
            o.z - u.trackPoint(1800, u.trackPoint(1800).left + 2.7).z,
          ) < 1,
      )[0];
      if (!b) throw new Error('missing contact board at station');
      globalThis.__board = b;
      u.teleport(1792, u.trackPoint(1800).left + 2.7, 90);
      const eye = u.trackPoint(1808, u.trackPoint(1800).left - 1, 2.8);
      u.tvCamera(eye.x, eye.y, eye.z, 50, { x: b.x, y: b.y + 0.5, z: b.z });
      u.drive({ throttle: 0, brake: 0, steer: 0 });
      u.setTimeScale(1);
    });
    await page.waitForFunction(
      () => globalThis.__undercut.view().props.debris.has(globalThis.__board.id),
      null,
      { timeout: 15000, polling: 10 },
    );
    for (const age of [0.03, 0.15, 0.35, 0.7, 1.5]) {
      await page.waitForFunction(
        (age) => {
          const u = globalThis.__undercut,
            hit = u.view().props.debris.get(globalThis.__board.id);
          return u.state().time - hit.time >= age;
        },
        age,
        { polling: 10 },
      );
      await page.evaluate(() => globalThis.__undercut.setTimeScale(0));
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(out, `break-${Math.round(age * 1000)}.png`) });
      fs.writeFileSync(
        path.join(out, `break-${Math.round(age * 1000)}.json`),
        JSON.stringify(await page.evaluate(() => globalThis.__undercut.capture()), null, 2),
      );
      await page.evaluate(() => globalThis.__undercut.setTimeScale(1));
    }
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
