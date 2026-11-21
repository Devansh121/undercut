// Screenshot stations v0: drive the built game through the debug API to fixed poses and capture
// them with the real GPU, at desktop (1440x900) and landscape phone (844x390) sizes.
//
//   npm run build && npm run shots -- monza            every station, both sizes
//   npm run shots -- monza --only grid,cockpit         some stations
//   npm run shots -- monza --perf                      also a 30 s frame-time run at 1080p High
//   npm run shots -- monza --lap                       also a full scripted lap and its HUD
//
// Output: artifacts/screenshots/<git-sha>/<station>-<w>x<h>.png and report.json. The GPU is
// shared by every agent on the machine, so the script re-runs itself under
// `flock ~/.cache/undercut/gpu.lock` before it launches a browser.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const circuit = args.find((a) => !a.startsWith('--')) ?? 'monza';
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (circuit !== 'monza') {
  console.error(`Only monza has stations in M1 (asked for ${circuit}).`);
  process.exit(2);
}

const LOCK = path.join(os.homedir(), '.cache/undercut/gpu.lock');
if (!process.env.UNDERCUT_GPU_LOCKED) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const r = spawnSync('flock', [LOCK, process.execPath, fileURLToPath(import.meta.url), ...args], {
    stdio: 'inherit',
    env: { ...process.env, UNDERCUT_GPU_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}

const PORT = Number(process.env.SHOTS_PORT ?? 4373);
const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const outDir = path.resolve(root, option('out') ?? `artifacts/screenshots/${sha}`);
fs.mkdirSync(outDir, { recursive: true });

// GPU-backed WebGL in headless Chromium through ANGLE on EGL.
const GPU_ARGS = [
  '--use-gl=angle',
  '--use-angle=gl-egl',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

/**
 * Stations: each sets the car up through the debug API, then freezes the sim (time scale 0) for
 * the capture. `drive` runs the keyboard autopilot until the car reaches `untilS`.
 */
const STATIONS = [
  { name: 'grid', camera: 'chase-near', setup: { restart: true, settle: 0.4 } },
  { name: 'chicane-braking', camera: 'chase-near', setup: { from: 380, kmh: 300, untilS: 545 } },
  { name: 'fast-corner', camera: 'chase-far', setup: { from: 900, kmh: 250, untilS: 1060 } },
  { name: 'cockpit', camera: 'cockpit', setup: { from: 4980, kmh: 200, untilS: 5180 } },
  { name: 'tcam', camera: 'tcam', setup: { from: 1450, kmh: 280, untilS: 1700 } },
  { name: 'straight', camera: 'chase-near', setup: { from: 60, kmh: 290, untilS: 330, drs: true } },
];

const VIEWPORTS = [
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
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    quality: 'mobile',
  },
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

async function openGame(browser, vp, extraQuery = '') {
  const context = await browser.newContext({
    viewport: vp.viewport,
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(
    `http://127.0.0.1:${PORT}/?debug=1&storage=memory&quality=${vp.quality}${extraQuery}`,
  );
  await page.waitForFunction(() => Boolean(globalThis.__undercut));
  await page.evaluate(() => globalThis.__undercut.start());
  await page.waitForFunction(() => globalThis.document.documentElement.dataset.ready !== undefined);
  return { context, page, errors };
}

async function runStation(page, station) {
  const s = station.setup;
  await page.evaluate((cam) => globalThis.__undercut.camera(cam), station.camera);
  if (s.restart) {
    await page.evaluate(() => globalThis.__undercut.restartLap());
    await page.waitForTimeout(s.settle * 1000);
  } else {
    await page.evaluate(({ from, kmh, drs }) => {
      const u = globalThis.__undercut;
      u.teleport(from, 0, kmh);
      // DRS shot: flat out down the straight with the flap requested; else the autopilot.
      if (drs) u.drive({ throttle: 1, drs: true, steer: 0 });
      else u.autopilot(true);
      u.setTimeScale(2);
    }, s);
    await page.waitForFunction((until) => globalThis.__undercut.state().s >= until, s.untilS, {
      timeout: 60_000,
      polling: 50,
    });
  }
  await page.evaluate(() => globalThis.__undercut.setTimeScale(0));
  // Let the cameras settle on the frozen car for a few frames (they run on real time).
  await page.waitForTimeout(700);
}

async function shots(browser, report) {
  const only = option('only')?.split(',');
  const sizes = option('viewport')?.split(',');
  for (const vp of VIEWPORTS) {
    if (sizes && !sizes.includes(vp.label)) continue;
    const { context, page, errors } = await openGame(browser, vp);
    for (const station of STATIONS) {
      if (only && !only.includes(station.name)) continue;
      await runStation(page, station);
      const file = path.join(outDir, `${station.name}-${vp.label}.png`);
      await page.screenshot({ path: file });
      const capture = await page.evaluate(() => globalThis.__undercut.capture());
      report.shots.push({
        station: station.name,
        viewport: vp.label,
        file: path.relative(root, file),
        state: capture.state,
        hud: capture.hud,
      });
      console.log(`  ${path.relative(root, file)}`);
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.autopilot(false);
        u.drive(null);
        u.setTimeScale(1);
      });
    }
    if (errors.length) report.errors.push(...errors.map((e) => `${vp.label}: ${e}`));
    await context.close();
  }
}

function summarise(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const worst = sorted.slice(Math.floor(sorted.length * 0.99));
  const worstMean = worst.reduce((a, b) => a + b, 0) / worst.length;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1];
  return {
    frames: times.length,
    avgFps: +(1000 / mean).toFixed(1),
    onePercentLowFps: +(1000 / worstMean).toFixed(1),
    p99FrameMs: +p99.toFixed(2),
    meanFrameMs: +mean.toFixed(2),
  };
}

async function perf(report, uncapped) {
  const browser = await chromium.launch({
    args: [...GPU_ARGS, ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
  });
  try {
    const vp = {
      label: '1920x1080',
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      quality: 'high',
    };
    const { context, page } = await openGame(browser, vp);
    await page.evaluate(() => {
      const u = globalThis.__undercut;
      u.camera('chase-near');
      u.teleport(5300, 0, 250);
      u.autopilot(true);
    });
    await page.waitForTimeout(3000);
    await page.evaluate(() => globalThis.__undercut.resetFrameTimes());
    await page.waitForTimeout(30_000);
    const times = await page.evaluate(() => globalThis.__undercut.frameTimes());
    const stats = await page.evaluate(() => globalThis.__undercut.renderStats());
    const gpu = await page.evaluate(() => {
      const gl = globalThis.document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    const summary = { ...summarise(times), vsync: !uncapped, gpu, render: stats };
    report.perf.push(summary);
    console.log(`  perf ${uncapped ? 'uncapped' : 'vsync'}: ${JSON.stringify(summary)}`);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function lap(browser, report) {
  const vp = VIEWPORTS[0];
  const { context, page, errors } = await openGame(browser, vp);
  await page.evaluate(() => {
    const u = globalThis.__undercut;
    u.camera('chase-far');
    u.autopilot(true);
    u.setTimeScale(4);
  });
  await page.waitForFunction(() => globalThis.__undercut.state().lastLap !== null, null, {
    timeout: 120_000,
    polling: 200,
  });
  await page.evaluate(() => globalThis.__undercut.setTimeScale(0));
  await page.waitForTimeout(600);
  const file = path.join(outDir, `lap-${vp.label}.png`);
  await page.screenshot({ path: file });
  const capture = await page.evaluate(() => globalThis.__undercut.capture());
  report.lap = {
    file: path.relative(root, file),
    state: capture.state,
    hud: capture.hud,
    events: capture.events.filter((e) => e.type === 'lap' || e.type === 'invalidated'),
  };
  console.log(`  ${path.relative(root, file)} lap ${capture.hud.last}`);
  if (errors.length) report.errors.push(...errors);
  await context.close();
}

const server = startServer();
const report = { sha, circuit, shots: [], perf: [], lap: null, errors: [] };
try {
  await waitForServer(server);
  const browser = await chromium.launch({ args: GPU_ARGS });
  try {
    if (!flag('no-shots')) await shots(browser, report);
    if (flag('lap')) await lap(browser, report);
  } finally {
    await browser.close();
  }
  if (flag('perf')) {
    await perf(report, false);
    await perf(report, true);
  }
} finally {
  await stopServer(server);
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`Report: ${path.relative(root, path.join(outDir, 'report.json'))}`);
if (report.errors.length) {
  console.error(`Console errors:\n${report.errors.join('\n')}`);
  process.exit(1);
}
