// UI screenshot stations and HUD frame-time benchmark: captures every Slice 1 menu screen, the
// living gallery, and the time-trial HUD & pause menu on the real GPU at desktop (1440x900,
// 1280x720) and landscape phone (844x390), then measures uncapped frame time with HUD on vs off.
//
//   npm run build && node tools/screenshots/ui-shots.mjs
//   node tools/screenshots/ui-shots.mjs --out docs/evidence/m2-ui --no-bench
//
// Runs itself under the shared GPU lock (~/.cache/undercut/gpu.lock).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const LOCK = path.join(os.homedir(), '.cache/undercut/gpu.lock');
if (!process.env.UI_SHOTS_GPU_LOCKED) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const r = spawnSync('flock', [LOCK, process.execPath, fileURLToPath(import.meta.url), ...args], {
    stdio: 'inherit',
    env: { ...process.env, UI_SHOTS_GPU_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}

const PORT = Number(process.env.UI_SHOTS_PORT ?? 4473);
const outDir = path.resolve(root, option('out') ?? 'docs/evidence/m2-ui');
fs.mkdirSync(outDir, { recursive: true });

const GPU_ARGS = [
  '--use-gl=angle',
  '--use-angle=gl-egl',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

function startServer() {
  const child = spawn(process.execPath, ['tools/serve/start.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      HTTPS_PORT: String(PORT + 1),
      ROOMS_PORT: String(PORT + 514),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return { child, output: () => output };
}

async function waitForServer(server) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (server.child.exitCode !== null) throw new Error(`server exited:\n${server.output()}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not start:\n${server.output()}`);
}

async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  const done = new Promise((r) => server.child.once('exit', r));
  server.child.kill('SIGTERM');
  await Promise.race([done, new Promise((r) => setTimeout(r, 10_000))]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

async function settle(page, ms = 350) {
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.waitForTimeout(ms);
}

async function shot(page, name, fullPage = false) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`  ${path.relative(root, file)} (${kb} KiB)`);
  return path.relative(root, file);
}

function summarise(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  return {
    frames: times.length,
    meanMs: +mean.toFixed(3),
    medianMs: +at(0.5).toFixed(3),
    p95Ms: +at(0.95).toFixed(3),
    p99Ms: +at(0.99).toFixed(3),
  };
}

async function captureMenus(browser, report) {
  const base = `http://127.0.0.1:${PORT}`;

  // Desktop 1440x900
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await settle(page);
    report.shots.push(await shot(page, 'launch-1440x900'));

    await page.click('[data-action=press-start]');
    await page.waitForSelector('html[data-screen="hub"]');
    await settle(page);
    report.shots.push(await shot(page, 'hub-1440x900'));

    await page.click('[data-action=mode-quickRace]');
    await settle(page, 250);
    report.shots.push(await shot(page, 'hub-notice-1440x900'));

    await page.click('[data-action=mode-timeTrial]');
    await page.click('[data-action=change-circuit]');
    await page.waitForSelector('html[data-screen="circuits"]');
    await settle(page);
    report.shots.push(await shot(page, 'circuits-1440x900'));

    await page.goto(`${base}/ui-gallery.html`);
    await settle(page);
    report.shots.push(await shot(page, 'ui-gallery-1440x900'));
    await ctx.close();
  }

  // Laptop 1280x720
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await page.click('[data-action=press-start]');
    await page.waitForSelector('html[data-screen="hub"]');
    await settle(page);
    report.shots.push(await shot(page, 'hub-1280x720'));
    await ctx.close();
  }

  // Phone landscape 844x390 (deviceScaleFactor 2 keeps evidence files crisp and small)
  {
    const ctx = await browser.newContext({
      viewport: { width: 844, height: 390 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(`${base}/`);
    await settle(page);
    report.shots.push(await shot(page, 'launch-844x390'));

    await page.tap('[data-action=press-start]');
    await page.waitForSelector('html[data-screen="hub"]');
    await settle(page);
    report.shots.push(await shot(page, 'hub-844x390'));

    await page.tap('[data-action=edit-settings]');
    await page.waitForSelector('[data-testid=settings-dialog]:not([hidden])');
    await settle(page, 250);
    report.shots.push(await shot(page, 'hub-settings-dialog-844x390'));
    await page.tap('[data-testid=settings-dialog] [data-action=dialog-close]');

    await page.tap('[data-action=change-circuit]');
    await page.waitForSelector('html[data-screen="circuits"]');
    await settle(page);
    report.shots.push(await shot(page, 'circuits-844x390'));
    await ctx.close();
  }
}

async function captureHudAndPause(browser, report) {
  const base = `http://127.0.0.1:${PORT}`;
  const viewports = [
    {
      label: '1440x900',
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      quality: 'high',
    },
    {
      label: '844x390',
      viewport: { width: 844, height: 390 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      quality: 'mobile',
    },
  ];

  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: vp.viewport,
      deviceScaleFactor: vp.deviceScaleFactor,
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
    });
    const page = await ctx.newPage();
    await page.goto(`${base}/?debug=1&quality=${vp.quality}`);
    await page.waitForFunction(() => Boolean(globalThis.__undercut));
    await page.evaluate(() => globalThis.__undercut.start());
    await page.waitForFunction(
      () => globalThis.document.documentElement.dataset.ready !== undefined,
      {
        timeout: 60_000,
      },
    );

    // Drive along the main straight at speed so rev lights, gear, speed, DRS and ERS are live.
    await page.evaluate(() => {
      const u = globalThis.__undercut;
      u.camera('chase-near');
      u.teleport(5300, 0, 260);
      u.autopilot(true);
      u.setTimeScale(2);
    });
    await page.waitForFunction(() => globalThis.__undercut.state().s >= 5640, null, {
      timeout: 60_000,
      polling: 50,
    });
    await page.evaluate(() => globalThis.__undercut.setTimeScale(0));
    await settle(page, 600);

    const framing = await page.evaluate(() => {
      const car = globalThis.__undercut.carScreenRect();
      const c = globalThis.document.querySelector('.hud-drive')?.getBoundingClientRect();
      const cluster = c ? { left: c.left, top: c.top, right: c.right, bottom: c.bottom } : null;
      const overlap =
        cluster !== null &&
        car.left < cluster.right &&
        cluster.left < car.right &&
        car.top < cluster.bottom &&
        cluster.top < car.bottom;
      return { car, cluster, overlap };
    });
    if (framing.overlap) {
      report.errors.push(
        `hud-drive ${vp.label}: car overlaps .hud-drive (${JSON.stringify(framing)})`,
      );
    }
    report.shots.push(await shot(page, `hud-drive-${vp.label}`));

    // Capture the lap-invalid state on desktop.
    if (vp.label === '1440x900') {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.setTimeScale(1);
        u.resetToTrack();
      });
      await settle(page, 400);
      report.shots.push(await shot(page, 'hud-invalid-1440x900'));
    }

    // Pause menu over the frozen frame. On phone, tap the real touch pause button so the
    // input arbiter returns to touch after the keyboard-driven autopilot.
    if (vp.hasTouch) {
      await page.evaluate(() => {
        globalThis.__undercut.autopilot(false);
        globalThis.__undercut.setTimeScale(1);
      });
      await page.tap('.ut-touch__btn--pause');
      await page.waitForSelector('[data-testid=pause-menu]:not([hidden])');
    } else {
      await page.evaluate(() => globalThis.__undercut.pause());
    }
    await settle(page, 300);
    report.shots.push(await shot(page, `pause-${vp.label}`));
    await ctx.close();
  }
}

async function benchmarkHud(report) {
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch({
    args: [...GPU_ARGS, '--disable-gpu-vsync', '--disable-frame-rate-limit'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/?debug=1&quality=high`);
    await page.waitForFunction(() => Boolean(globalThis.__undercut));
    await page.evaluate(() => globalThis.__undercut.start());
    await page.waitForFunction(
      () => globalThis.document.documentElement.dataset.ready !== undefined,
      {
        timeout: 60_000,
      },
    );

    const measure = async (hudOn) => {
      await page.evaluate((on) => {
        const u = globalThis.__undercut;
        u.camera('chase-near');
        u.teleport(4300, 0, 250);
        u.autopilot(true);
        u.setTimeScale(1);
        u.setHudVisible(on);
      }, hudOn);
      await page.waitForTimeout(2000);
      await page.evaluate(() => globalThis.__undercut.resetFrameTimes());
      await page.waitForTimeout(6000);
      const times = await page.evaluate(() => globalThis.__undercut.frameTimes());
      return summarise(times);
    };

    const hudOn = await measure(true);
    const hudOff = await measure(false);
    report.hudBench = {
      viewport: '1440x900',
      quality: 'high',
      vsync: false,
      hudOn,
      hudOff,
      deltaMeanMs: +(hudOn.meanMs - hudOff.meanMs).toFixed(3),
      deltaMedianMs: +(hudOn.medianMs - hudOff.medianMs).toFixed(3),
    };
    console.log('  hudBench:', JSON.stringify(report.hudBench));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

const server = startServer();
const report = { shots: [], hudBench: null, errors: [] };
try {
  await waitForServer(server);
  const browser = await chromium.launch({ args: GPU_ARGS });
  try {
    await captureMenus(browser, report);
    await captureHudAndPause(browser, report);
  } finally {
    await browser.close();
  }
  if (!flag('no-bench')) await benchmarkHud(report);
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.errors.length) {
    console.error('Errors:', report.errors);
    process.exitCode = 1;
  }
} finally {
  await stopServer(server);
}
