// Screenshot stations v0: drive the built game through the debug API to fixed poses and capture
// them with the real GPU, at desktop (1440x900) and landscape phone (844x390) sizes.
//
//   npm run build && npm run shots -- monza            every station, both sizes
//   npm run shots -- monza --only grid,cockpit         some stations
//   npm run shots -- monza --perf                      also frame-time runs (drive, full grid) at
//                                                      1080p High and 844x390 Mobile, vsync off
//   npm run shots -- monza --moving                    also a 10 s recording cut into frame strips
//   npm run shots -- monza --lap                       also a full scripted lap and its HUD
//   npm run shots -- monza --no-shots --perf           only the frame-time runs
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
if (!process.env.SHOTS_GPU_LOCKED) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const r = spawnSync('flock', [LOCK, process.execPath, fileURLToPath(import.meta.url), ...args], {
    stdio: 'inherit',
    env: { ...process.env, SHOTS_GPU_LOCKED: '1' },
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
 * Stations: each sets the scene up through the debug API, then freezes the sim (time scale 0)
 * for the capture. Driving stations run the keyboard autopilot (or a held input) from a lap
 * position until the car reaches `untilS`. See docs/render.md for what each one is for.
 */
const drive =
  (from, kmh, untilS, opts = {}) =>
  async (page) => {
    await page.evaluate(
      ({ from, kmh, opts }) => {
        const u = globalThis.__undercut;
        u.teleport(from, opts.d ?? 0, kmh);
        if (opts.hold) u.drive(opts.hold);
        else u.autopilot(true);
        u.setTimeScale(2);
      },
      { from, kmh, opts },
    );
    await page.waitForFunction((until) => globalThis.__undercut.state().s >= until, untilS, {
      timeout: 60_000,
      polling: 50,
    });
  };

const STATIONS = [
  {
    // The full field from in front of the pole slot, twenty cars in ten liveries.
    name: 'grid-front',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.restartLap();
        u.setTimeScale(0);
        u.gridCars(19);
        const eye = u.trackPoint(5812, 3.5, 1.7);
        const aim = u.trackPoint(5716, -0.5, 0.6);
        u.tvCamera(eye.x, eye.y, eye.z, 24, aim);
      });
    },
    after: (page) => page.evaluate(() => globalThis.__undercut.gridCars(0)),
  },
  { name: 'chicane-braking', camera: 'chase-near', run: drive(380, 300, 545) },
  { name: 'fast-corner', camera: 'chase-far', run: drive(900, 250, 1060) },
  { name: 'cockpit', camera: 'cockpit', run: drive(4980, 200, 5180) },
  { name: 'tcam', camera: 'tcam', run: drive(1450, 280, 1700) },
  { name: 'straight', camera: 'chase-near', run: drive(5300, 260, 5640) },
  {
    // A low trackside long lens on the car riding the exit kerb of the first chicane.
    name: 'tv-kerb',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        let s = 640;
        for (let k = 600; k < 760; k += 2) {
          if (u.trackPoint(k).kerbLeft) {
            s = k + 6;
            break;
          }
        }
        const p = u.trackPoint(s);
        u.teleport(s, p.left + 0.35, 110);
        u.drive({ throttle: 0.4, steer: 0 });
        u.setTimeScale(1);
        globalThis.__kerbS = s;
      });
      await page.waitForTimeout(250);
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.setTimeScale(0);
        const s = u.state().s;
        const eye = u.trackPoint(s + 34, u.trackPoint(s).left + 5.5, 1.25);
        u.tvCamera(eye.x, eye.y, eye.z, 11);
      });
    },
  },
  {
    // A parked car in the pit lane, close.
    name: 'pit-lane',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.teleport(5000, 0, 0);
        u.setTimeScale(0);
        const b = u.pitCar(4, 6);
        if (!b) return;
        // Ahead and to one side of the nose, at standing eye height.
        const fx = Math.cos(b.yaw);
        const fz = -Math.sin(b.yaw);
        const eye = { x: b.x + fx * 4.2 - fz * 2.6, y: b.y + 1.45, z: b.z + fz * 4.2 + fx * 2.6 };
        u.tvCamera(eye.x, eye.y, eye.z, 38, {
          x: b.x + fx * 0.3,
          y: b.y + 0.45,
          z: b.z + fz * 0.3,
        });
      });
    },
    after: (page) => page.evaluate(() => globalThis.__undercut.gridCars(0)),
  },
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

async function openGame(browser, vp, extraQuery = '', launchShot = null) {
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
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1&quality=${vp.quality}${extraQuery}`);
  await page.waitForFunction(() => Boolean(globalThis.__undercut));
  if (launchShot) {
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.screenshot({ path: launchShot });
  }
  await page.evaluate(() => globalThis.__undercut.start());
  await page.waitForFunction(() => globalThis.document.documentElement.dataset.ready !== undefined);
  return { context, page, errors };
}

async function runStation(page, station) {
  await page.evaluate(
    (cam) => globalThis.__undercut.camera(cam),
    station.camera === 'tv' ? 'chase-near' : station.camera,
  );
  await station.run(page);
  await page.evaluate(() => globalThis.__undercut.setTimeScale(0));
  // Let the cameras settle on the frozen car for a few frames (they run on real time).
  await page.waitForTimeout(900);
}

async function shots(browser, report) {
  const only = option('only')?.split(',');
  const sizes = option('viewport')?.split(',');
  for (const vp of VIEWPORTS) {
    if (sizes && !sizes.includes(vp.label)) continue;
    const launchFile = path.join(outDir, `launch-${vp.label}.png`);
    const { context, page, errors } = await openGame(browser, vp, '', launchFile);
    console.log(`  ${path.relative(root, launchFile)}`);
    for (const station of STATIONS) {
      if (only && !only.includes(station.name)) continue;
      await runStation(page, station);
      const file = path.join(outDir, `${station.name}-${vp.label}.png`);
      await page.screenshot({ path: file });
      const capture = await page.evaluate(() => globalThis.__undercut.capture());
      // Framing check: in the chase cameras the whole car stays clear of the driver cluster.
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
      if (station.camera.startsWith('chase') && framing.overlap) {
        report.errors.push(
          `${station.name} ${vp.label}: the car (${JSON.stringify(framing.car)}) overlaps the driver cluster (${JSON.stringify(framing.cluster)})`,
        );
      }
      report.shots.push({
        framing,
        station: station.name,
        viewport: vp.label,
        file: path.relative(root, file),
        state: capture.state,
        hud: capture.hud,
      });
      console.log(`  ${path.relative(root, file)}`);
      if (station.after) await station.after(page);
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.autopilot(false);
        u.drive(null);
        u.camera('chase-near');
        u.setTimeScale(1);
      });
    }
    // The pause menu over the frozen frame.
    await page.evaluate(() => globalThis.__undercut.pause());
    await page.waitForTimeout(300);
    const pauseFile = path.join(outDir, `pause-${vp.label}.png`);
    await page.screenshot({ path: pauseFile });
    console.log(`  ${path.relative(root, pauseFile)}`);
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

/**
 * Frame-time runs on the GPU: the scripted drive (autopilot from Ascari to the line) and the full
 * grid in view (twenty cars, cameras and sim running, cars static), at 1080p on High and 844x390
 * on Mobile; once with vsync (does it hold 60 fps) and once without (the headroom; its 1 % lows
 * are dominated by the browser's uncapped frame pacing and are not a target).
 */
const PERF_VIEWPORTS = [
  {
    label: '1920x1080',
    viewport: { width: 1920, height: 1080 },
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

async function perf(report) {
  for (const vsync of [true, false]) await perfRuns(report, vsync);
}

async function perfRuns(report, vsync) {
  const browser = await chromium.launch({
    args: [...GPU_ARGS, ...(vsync ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'])],
  });
  try {
    for (const vp of PERF_VIEWPORTS) {
      const quality = option('perf-quality') ?? vp.quality;
      const { context, page } = await openGame(browser, { ...vp, quality });
      for (const run of ['drive', 'grid']) {
        await page.evaluate((run) => {
          const u = globalThis.__undercut;
          u.autopilot(false);
          u.drive(null);
          u.gridCars(0);
          if (run === 'drive') {
            u.camera('chase-near');
            u.teleport(4300, 0, 250);
            u.autopilot(true);
          } else {
            // From the last slot looking up the grid: nineteen cars ahead, all in view.
            u.restartLap();
            u.gridCars(19);
            u.camera('chase-far');
            u.drive({ throttle: 0, brake: 1, steer: 0 });
          }
        }, run);
        await page.waitForTimeout(3000);
        await page.evaluate(() => globalThis.__undercut.resetFrameTimes());
        await page.waitForTimeout(Number(option('perf-seconds') ?? 20) * 1000);
        const times = await page.evaluate(() => globalThis.__undercut.frameTimes());
        const stats = await page.evaluate(() => globalThis.__undercut.renderStats());
        const gpu = await page.evaluate(() => {
          const gl = globalThis.document.createElement('canvas').getContext('webgl2');
          const ext = gl?.getExtension('WEBGL_debug_renderer_info');
          return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
        });
        const file = path.join(outDir, `perf-${run}-${vp.label}.png`);
        await page.screenshot({ path: file });
        const summary = {
          run,
          viewport: vp.label,
          quality,
          vsync,
          ...summarise(times),
          gpu,
          render: stats,
          file: path.relative(root, file),
        };
        report.perf.push(summary);
        console.log(
          `  perf ${run} ${vp.label} ${quality} vsync=${vsync}: ${JSON.stringify(summary)}`,
        );
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

/**
 * Ten seconds of driving recorded as video (chase cam through the first chicane), cut into a
 * one-per-second strip and a strip of consecutive frames to judge shimmer on kerbs and edges.
 */
async function moving(browser, report) {
  const vp = VIEWPORTS[0];
  const videoDir = path.join(outDir, 'video');
  fs.mkdirSync(videoDir, { recursive: true });
  const context = await browser.newContext({
    viewport: vp.viewport,
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: vp.viewport },
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1&quality=${vp.quality}`);
  await page.waitForFunction(() => Boolean(globalThis.__undercut));
  await page.evaluate(() => globalThis.__undercut.start());
  await page.waitForFunction(() => globalThis.document.documentElement.dataset.ready !== undefined);
  await page.evaluate(() => {
    const u = globalThis.__undercut;
    u.camera('chase-near');
    u.teleport(150, 0, 280);
    u.autopilot(true);
  });
  const t0 = Date.now();
  await page.waitForTimeout(12_000);
  const video = page.video();
  await context.close();
  const src = await video.path();
  const mp4 = path.join(outDir, 'moving-1440x900.mp4');
  const start = Math.max(0, (Date.now() - t0) / 1000 - 12 + 2).toFixed(2);
  const ff = (a) => spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
  ff([
    '-ss',
    start,
    '-i',
    src,
    '-t',
    '10',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '20',
    mp4,
  ]);
  const strip = path.join(outDir, 'moving-strip.jpg');
  ff(['-i', mp4, '-vf', 'fps=1,scale=480:-1,tile=5x2', '-frames:v', '1', '-q:v', '3', strip]);
  // Eight consecutive frames from the middle, cropped to the lower half where kerbs and lines are.
  const burst = path.join(outDir, 'moving-burst.jpg');
  ff([
    '-ss',
    '5',
    '-i',
    mp4,
    '-vf',
    'crop=1440:450:0:450,scale=720:-1,tile=2x4',
    '-frames:v',
    '1',
    '-q:v',
    '3',
    burst,
  ]);
  report.moving = {
    video: path.relative(root, mp4),
    strip: path.relative(root, strip),
    burst: path.relative(root, burst),
  };
  console.log(`  ${path.relative(root, strip)}`);
  fs.rmSync(videoDir, { recursive: true, force: true });
}

async function lap(browser, report) {
  const vp = VIEWPORTS[0];
  const { context, page, errors } = await openGame(browser, vp);
  await page.evaluate(() => {
    const u = globalThis.__undercut;
    u.camera('chase-far');
    u.autopilot(true);
    // Restart in the same call, so the lap does not depend on how many neutral ticks ran
    // before the autopilot took over: the run is then the same every time.
    u.restartLap();
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
const report = { sha, circuit, shots: [], perf: [], lap: null, moving: null, errors: [] };
try {
  await waitForServer(server);
  const browser = await chromium.launch({ args: GPU_ARGS });
  try {
    if (!flag('no-shots')) await shots(browser, report);
    if (flag('lap')) await lap(browser, report);
    if (flag('moving')) await moving(browser, report);
  } finally {
    await browser.close();
  }
  if (flag('perf')) await perf(report);
} finally {
  await stopServer(server);
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`Report: ${path.relative(root, path.join(outDir, 'report.json'))}`);
if (report.errors.length) {
  console.error(`Console errors:\n${report.errors.join('\n')}`);
  process.exit(1);
}
