// GPU evidence at the second chicane's left verge (s 1800 m), beside the screen and catch fence:
// the same scripted run into the verge panel there, framed by one trackside camera, captured at
// the same sim times. Point CLIENT_DIR at another build (master) for the before frames.
//
//   timeout 900 flock ~/.cache/undercut/gpu.lock node tools/screenshots/board-contact.mjs <out>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const out = path.resolve(process.argv[2] ?? 'board-contact');
fs.mkdirSync(out, { recursive: true });
const port = Number(process.env.SHOTS_PORT ?? 4493);
if (port === 6151) throw new Error('reserved capture port');
/** Sim seconds after the car is placed 15 m before the panel at 90 km/h. */
const TIMES = [0.3, 0.5, 0.65, 0.8, 1.0, 1.3, 1.8, 2.6, 4.0, 7.0];
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
  const t0 = await page.evaluate(() => {
    const u = globalThis.__undercut;
    u.setTimeScale(0);
    u.setHudVisible(false);
    globalThis.document.querySelectorAll('.onboarding').forEach((el) => el.remove());
    const d = u.trackPoint(1800).left + 2.7;
    const board = u.trackPoint(1800, d);
    const eye = u.trackPoint(1814, u.trackPoint(1814).left - 3.5, 1.8);
    u.teleport(1785, d, 90);
    u.tvCamera(eye.x, eye.y, eye.z, 45, { x: board.x, y: board.y + 0.6, z: board.z });
    u.drive({ throttle: 0, brake: 0, steer: 0 });
    return u.state().time;
  });
  const log = [];
  for (const at of TIMES) {
    await page.evaluate(() => globalThis.__undercut.setTimeScale(0.25));
    await page.waitForFunction(
      ({ t0, at }) => globalThis.__undercut.state().time - t0 >= at,
      { t0, at },
      {
        polling: 'raf',
        timeout: 60000,
      },
    );
    await page.evaluate(() => globalThis.__undercut.setTimeScale(0));
    await page.waitForTimeout(150);
    const name = `t${String(Math.round(at * 1000)).padStart(4, '0')}`;
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    log.push(
      await page.evaluate(
        ({ t0, name }) => {
          const u = globalThis.__undercut,
            s = u.state();
          return {
            frame: name,
            t: +(s.time - t0).toFixed(3),
            s: +s.s.toFixed(2),
            d: +s.d.toFixed(2),
            speed: u.dashboard()?.speed,
            wallHits: s.wallHits,
            safetyResets: s.safetyResets,
          };
        },
        { t0, name },
      ),
    );
  }
  fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
