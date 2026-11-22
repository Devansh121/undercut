// Screenshot stations v0: drive the built game through the debug API to fixed poses and capture
// them with the real GPU, at desktop (1440x900) and landscape phone (844x390) sizes.
//
//   npm run build && npm run shots -- monza            every station, both sizes
//   npm run shots -- monza --only grid,cockpit         some stations
//   npm run shots -- monza --only cockpit,cockpit-chicane,cockpit-lesmo --query tod=night-floodlit
//                                                      the cockpit tour at night
//   npm run shots -- monza --perf                      also frame-time runs (drive, full grid) at
//                                                      1080p High and 844x390 Mobile, vsync off
//   npm run shots -- monza --moving                    also a 10 s recording cut into frame strips
//   npm run shots -- monza --lap                       also a full scripted lap and its HUD
//   npm run shots -- monza --lifecycle                 also five High sessions on one page: no GL
//                                                      object or program may leak (GPU twin of
//                                                      tests/browser/lifecycle.nightly.spec.ts)
//   npm run shots -- monza --tree-swap-check          also near trees against the cards they replace:
//                                                      mean luma with and without them, day and
//                                                      night, within 10 %
//   npm run shots -- monza --sky-check                 also full-frame High sky comparison: direct
//                                                      path (float targets hidden) vs HDR path
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

if (!['monza', 'spa', 'singapore'].includes(circuit)) {
  console.error(`No stations for ${circuit} (monza, spa, singapore).`);
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

const MONZA_STATIONS = [
  {
    // The full field from in front of the pole slot, twenty cars in ten liveries, five red lights on.
    name: 'grid-front',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.restartLap();
        u.setTimeScale(0);
        u.gridCars(19);
        u.setStartLights(31);
        const eye = u.trackPoint(5812, 3.5, 1.7);
        const aim = u.trackPoint(5716, -0.5, 0.6);
        u.tvCamera(eye.x, eye.y, eye.z, 24, aim);
      });
    },
    after: (page) =>
      page.evaluate(() => {
        globalThis.__undercut.setStartLights(0);
        globalThis.__undercut.gridCars(0);
      }),
  },
  { name: 'chicane-braking', camera: 'chase-near', run: drive(380, 300, 545) },
  { name: 'fast-corner', camera: 'chase-far', run: drive(900, 250, 1060) },
  { name: 'cockpit', camera: 'cockpit', run: drive(4980, 200, 5180) },
  // The cockpit at two more places round the lap: braking for the first chicane, and Lesmo.
  { name: 'cockpit-chicane', camera: 'cockpit', run: drive(380, 300, 520) },
  { name: 'cockpit-lesmo', camera: 'cockpit', run: drive(1450, 280, 1640) },
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
  {
    // Down the start straight from main-grandstand height: pit complex, pit wall, gantry, crowd, corridor.
    name: 'stand-straight',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.restartLap();
        u.setTimeScale(0);
        u.gridCars(19);
        u.setStartLights(31);
        const eye = u.trackPoint(5520, 22, 11.5);
        const aim = u.trackPoint(5775, -14, 3.5);
        u.tvCamera(eye.x, eye.y, eye.z, 32, aim);
      });
    },
    after: (page) =>
      page.evaluate(() => {
        globalThis.__undercut.setStartLights(0);
        globalThis.__undercut.gridCars(0);
      }),
  },
  {
    // Outside the first chicane: braking boards, catch fencing, run-off aprons, grandstands, trees.
    name: 'chicane-outside',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.teleport(612, 0.5, 95);
        u.setTimeScale(0);
        const eye = u.trackPoint(685, 22, 5.2);
        const aim = u.trackPoint(585, -2, 1.5);
        u.tvCamera(eye.x, eye.y, eye.z, 34, aim);
      });
    },
  },
  {
    // Through the Lesmo woodland corridor: dense trees, angled grass-verge boards, marshal post.
    name: 'lesmo-trees',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.teleport(2440, -1.5, 195);
        u.setTimeScale(0);
        const eye = u.trackPoint(2540, 12, 3.6);
        const aim = u.trackPoint(2420, -2, 1.4);
        u.tvCamera(eye.x, eye.y, eye.z, 28, aim);
      });
    },
  },
  {
    // Elevated camera-tower angle over Variante Ascari: chicane kerbs, stands, big screen, woodland.
    name: 'ascari-tower',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.teleport(3710, -1.0, 175);
        u.setTimeScale(0);
        const eye = u.trackPoint(3820, -24, 14.0);
        const aim = u.trackPoint(3690, 2, 1.5);
        u.tvCamera(eye.x, eye.y, eye.z, 34, aim);
      });
    },
  },
  {
    // Outside Curva Alboreto (Parabolica): sweeping corner, gravel, stands, bridge, distant treeline.
    name: 'parabolica-outside',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.teleport(4960, -1.5, 210);
        u.setTimeScale(0);
        const eye = u.trackPoint(5085, 34, 9.5);
        const aim = u.trackPoint(4940, -4, 1.5);
        u.tvCamera(eye.x, eye.y, eye.z, 36, aim);
      });
    },
  },
  {
    // High three-quarter helicopter view framing the start straight, pit complex, grandstands, and Turn 1.
    name: 'sector1-heli',
    camera: 'tv',
    run: async (page) => {
      await page.evaluate(() => {
        const u = globalThis.__undercut;
        u.restartLap();
        u.setTimeScale(0);
        u.gridCars(19);
        const eye = u.trackPoint(5520, 105, 68);
        const aim = u.trackPoint(90, -10, 4);
        u.tvCamera(eye.x, eye.y, eye.z, 38, aim);
      });
    },
    after: (page) => page.evaluate(() => globalThis.__undercut.gridCars(0)),
  },
];

/** A chase-camera station driving from `from` to `to` (lap metres) at `kmh`. */
const chase = (name, from, kmh, to, camera = 'chase-near') => ({
  name,
  camera,
  run: drive(from, kmh, to),
});
/** A trackside or high camera: eye at (s, d, h), aimed at (s2, d2, h2), with the sim frozen. */
const tv = (name, eye, aim, fov) => ({
  name,
  camera: 'tv',
  run: async (page) => {
    await page.evaluate(
      ({ eye, aim, fov }) => {
        const u = globalThis.__undercut;
        u.teleport(aim[0], 0, 0);
        u.setTimeScale(0);
        const e = u.trackPoint(eye[0], eye[1], eye[2]);
        const a = u.trackPoint(aim[0], aim[1], aim[2]);
        u.tvCamera(e.x, e.y, e.z, fov, a);
      },
      { eye, aim, fov },
    );
  },
});
/** Stations of the circuits after Monza, by corner (see each track file's corner list). */
const CIRCUIT_STATIONS = {
  spa: [
    tv('grid-tv', [20, 6, 3], [6900, 0, 0.8], 30),
    chase('la-source', 120, 230, 250),
    chase('eau-rouge', 760, 260, 960, 'chase-far'),
    tv('raidillon-tv', [1250, -18, 6], [1010, 0, 1], 34),
    chase('kemmel', 1500, 290, 1900),
    tv('les-combes-tv', [2200, 25, 8], [2330, 0, 1], 38),
    chase('pouhon', 3550, 250, 3740, 'chase-far'),
    tv('paddock-heli', [6750, 120, 70], [6950, -40, 0], 42),
  ],
  singapore: [
    tv('grid-tv', [12, 5, 3], [4840, 0, 0.8], 30),
    chase('turn-1', 120, 260, 280),
    chase('raffles', 650, 230, 820),
    tv('esplanade-tv', [2850, 20, 6], [2700, 0, 1], 34),
    chase('marina', 3300, 230, 3460, 'chase-far'),
    tv('marina-heli', [3600, -150, 80], [3450, 0, 0], 45),
    chase('promenade', 4400, 200, 4560),
  ],
};
const STATIONS = circuit === 'monza' ? MONZA_STATIONS : CIRCUIT_STATIONS[circuit];

/** Sessions start on the chosen circuit: the menu's saved choice, set before the page loads. */
async function onCircuit(context) {
  if (circuit === 'monza') return;
  await context.addInitScript((id) => {
    globalThis.localStorage.setItem('menu.prefs', JSON.stringify({ version: 1, circuit: id }));
  }, circuit);
}

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
    let body = null;
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) body = await res.text();
    } catch {
      // not up yet
    }
    if (body !== null) {
      // Another checkout's server on the same port would answer too, and the stations would
      // capture its game. Only this checkout's build will do.
      const ours = fs.readFileSync(path.join(root, 'apps/web/dist/index.html'), 'utf8');
      if (body !== ours)
        throw new Error(`port ${PORT} serves another build (set SHOTS_PORT to a free port)`);
      return;
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
  await onCircuit(context);
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

async function mobileUi(browser, report) {
  const vp = PERF_VIEWPORTS[1];
  const { context, page, errors } = await openGame(browser, vp);
  try {
    for (const size of [
      { width: 844, height: 390 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      const label = `${size.width}x${size.height}`;
      if (size.width > size.height) await page.evaluate(() => globalThis.__undercut.resume());
      const landscape = size.width > size.height;
      const screens = ['onboarding', ...(landscape ? ['onboarding-step2'] : []), 'hud'];
      for (const screen of [...screens, 'pause', 'settings']) {
        if (screen === 'onboarding') {
          await page.evaluate(() => globalThis.__undercut.pause());
          // Pause offers Skip while the coach runs and Replay once it is done.
          const skip = page.locator('[data-action=skip-intro]');
          if (await skip.isVisible()) await skip.click();
          await page.locator('[data-action=replay-intro]').click();
        }
        if (screen === 'onboarding-step2') {
          // The first tip moves on by driving alone.
          await page.evaluate(() => globalThis.__undercut.drive({ throttle: 1 }));
          await page.waitForTimeout(4000);
          await page.evaluate(() => globalThis.__undercut.drive(null));
        }
        if (screen === 'hud') {
          await page.evaluate(() => globalThis.__undercut.pause());
          await page.locator('[data-action=skip-intro]').click();
          await page.evaluate(() => globalThis.__undercut.resume());
        }
        if (screen === 'pause' || screen === 'settings')
          await page.evaluate(() => globalThis.__undercut.pause());
        if (screen === 'pause')
          // Portrait keeps the menu open from the step before: show it from the top.
          await page.evaluate(() => {
            for (const n of globalThis.document.querySelectorAll(
              '[data-testid=pause-menu], .pause *',
            ))
              n.scrollTop = 0;
          });
        if (screen === 'settings')
          await page.locator('[data-slider=master]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const file = path.join(outDir, `${screen}-${label}.png`);
        await page.screenshot({ path: file, scale: 'css' });
        report.shots.push({ screen, viewport: label, file });
      }
    }
    report.errors.push(...errors);
  } finally {
    await page.evaluate(() => globalThis.__undercut.quit());
    await page.goto('about:blank');
    await context.close();
  }
}

async function shots(browser, report) {
  const only = option('only')?.split(',');
  const sizes = option('viewport')?.split(',');
  for (const vp of VIEWPORTS) {
    if (sizes && !sizes.includes(vp.label)) continue;
    const launchFile = path.join(outDir, `launch-${vp.label}.png`);
    // `--query tod=night-floodlit` (or any extra URL parameters) applies to every station.
    const query = option('query') ? `&${option('query')}` : '';
    const { context, page, errors } = await openGame(browser, vp, query, launchFile);
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
    medianFrameMs: +sorted[Math.floor(sorted.length * 0.5)].toFixed(2),
    p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
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
  for (const vsync of flag('phone-audit') ? [true] : [true, false]) await perfRuns(report, vsync);
}

async function perfRuns(report, vsync) {
  const browser = await chromium.launch({
    args: [...GPU_ARGS, ...(vsync ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'])],
  });
  try {
    for (const vp of flag('phone-audit')
      ? [2, 3].flatMap((deviceScaleFactor) =>
          [
            { width: 844, height: 390 },
            { width: 390, height: 844 },
          ].map((viewport) => ({
            label: `${viewport.width}x${viewport.height}-dpr${deviceScaleFactor}`,
            viewport,
            deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
            quality: 'mobile',
          })),
        )
      : PERF_VIEWPORTS) {
      const quality = option('perf-quality') ?? vp.quality;
      const { context, page } = await openGame(browser, { ...vp, quality });
      for (const run of flag('phone-audit')
        ? ['grid', 'chicane', 'lesmo', 'parabolica']
        : ['drive', 'grid']) {
        await page.evaluate((run) => {
          const u = globalThis.__undercut;
          u.autopilot(false);
          u.drive(null);
          u.gridCars(0);
          if (run === 'drive') {
            u.camera('chase-near');
            u.teleport(4300, 0, 250);
            u.autopilot(true);
          } else if (run !== 'grid') {
            u.camera('chase-near');
            u.teleport({ chicane: 600, lesmo: 2400, parabolica: 5400 }[run], 0, 0);
            u.drive({ throttle: 0, brake: 1, steer: 0 });
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
          memory: await page.evaluate(() => ({
            heapBytes: performance.memory?.usedJSHeapSize ?? null,
            resources: performance
              .getEntriesByType('resource')
              .reduce((sum, r) => sum + r.transferSize, 0),
          })),
          file: path.relative(root, file),
        };
        report.perf.push(summary);
        console.log(
          `  perf ${run} ${vp.label} ${quality} vsync=${vsync}: ${JSON.stringify(summary)}`,
        );
      }
      await page.evaluate(() => globalThis.__undercut.quit());
      await page.goto('about:blank');
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
  await onCircuit(context);
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

/**
 * The lifecycle check on the High preset, on the GPU (tests/browser/lifecycle.nightly.spec.ts runs it on
 * Mobile in CI): five sessions started and quit on one page; GL objects counted at the API must
 * not grow between sessions, and only the renderer's own state may remain (no geometry, at most
 * two textures and two programs), with no console warnings or errors.
 */
async function lifecycle(browser, report) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await onCircuit(context);
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));
  await page.addInitScript(() => {
    const balance = {};
    globalThis.__glBalance = balance;
    const proto = globalThis.WebGL2RenderingContext.prototype;
    for (const kind of [
      'Texture',
      'Framebuffer',
      'Program',
      'Shader',
      'Buffer',
      'Renderbuffer',
      'VertexArray',
    ]) {
      const create = proto[`create${kind}`];
      const remove = proto[`delete${kind}`];
      balance[kind] = 0;
      proto[`create${kind}`] = function (...a) {
        balance[kind]++;
        return create.apply(this, a);
      };
      proto[`delete${kind}`] = function (...a) {
        if (a[0]) balance[kind]--;
        return remove.apply(this, a);
      };
    }
  });
  await page.goto(`http://127.0.0.1:${PORT}/?debug=1&quality=high`);
  await page.waitForFunction(() => Boolean(globalThis.__undercut));
  const after = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => globalThis.__undercut.start());
    await page.waitForFunction(
      () => globalThis.document.documentElement.dataset.ready !== undefined,
    );
    await page.waitForFunction(() => globalThis.__undercut.state().tick > 20);
    await page.evaluate(() => globalThis.__undercut.quit());
    await page.waitForFunction(
      () => globalThis.document.documentElement.dataset.ready === undefined,
    );
    after.push(
      await page.evaluate(() => ({
        gl: { ...globalThis.__glBalance },
        info: globalThis.__undercut.rendererInfo(),
      })),
    );
  }
  await context.close();
  const same = after.every((a) => JSON.stringify(a) === JSON.stringify(after[0]));
  const info = after[0].info;
  const ok =
    same &&
    info.geometries === 0 &&
    info.textures <= 2 &&
    info.programs <= 2 &&
    problems.length === 0;
  report.lifecycle = { quality: 'high', ok, after, problems };
  console.log(`  lifecycle (high, GPU): ${ok ? 'ok' : 'FAILED'} ${JSON.stringify(after[0])}`);
  if (!ok)
    report.errors.push(`High lifecycle check failed: ${JSON.stringify({ same, info, problems })}`);
}

/**
 * Full-frame sky comparison on the High preset, on the GPU (GPU twin of tests/browser/sky.spec.ts):
 * compares the central sky band (where High's lens vignette is zero) between the HDR pipeline and
 * the direct fallback (half-float colour targets hidden) on a frozen grid start.
 */
/**
 * Near trees against the cards they replace (High, by day and under floodlights at night): the
 * same frozen poses drawn with the near trees on (the preset's swap distance) and off (0, cards
 * only), mean luma over the pixels that change. The two must be within TREE_SWAP_TOLERANCE, or
 * a band of lighter or darker trees travels with the camera.
 */
const TREE_SWAP_TOLERANCE = 0.1;
/**
 * Per circuit: the lighting each is checked under, its own (the menu's first choice) and one
 * more. Spa is only offered overcast; the afternoon sun is the harder second case there (night
 * is not offered at Spa).
 */
const SWAP_LIGHTING = {
  monza: [
    ['day', ''],
    ['night', '&tod=night-floodlit'],
  ],
  spa: [
    ['overcast', '&tod=overcast-day'],
    ['sun', '&tod=monza-afternoon'],
  ],
};
/** Per circuit: a chase pose through woods and a high view over them. */
const SWAP_POSES = {
  monza: {
    // Chase camera through the Lesmo woods, and a high view over the park.
    lesmo: () => {
      const u = globalThis.__undercut;
      u.camera('chase-near');
      u.teleport(1640, 0, 250);
      u.setTimeScale(0);
    },
    park: () => {
      const u = globalThis.__undercut;
      u.camera('tv');
      const e = u.trackPoint(2150, 70, 32);
      const a = u.trackPoint(2650, -40, 2);
      u.tvCamera(e.x, e.y, e.z, 42, a);
    },
  },
  spa: {
    // Chase camera past the spruce plantation before Blanchimont (needleleaved on the map), and
    // a view from above the far verge across to it, low enough that the near trees fill part of
    // the frame (from 30 m up they cover 0.2% of it).
    blanchimont: () => {
      const u = globalThis.__undercut;
      u.camera('chase-near');
      u.teleport(5600, 0, 250);
      u.setTimeScale(0);
    },
    plantation: () => {
      const u = globalThis.__undercut;
      u.camera('tv');
      const e = u.trackPoint(5450, -25, 14);
      const a = u.trackPoint(5620, 60, 6);
      u.tvCamera(e.x, e.y, e.z, 42, a);
    },
  },
};
async function treeSwapCheck(browser, report) {
  const problems = [];
  const cases = [];
  for (const [label, tod] of SWAP_LIGHTING[circuit]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await onCircuit(context);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&quality=high${tod}`);
    await page.waitForFunction(() => Boolean(globalThis.__undercut));
    await page.evaluate(() => globalThis.__undercut.start());
    await page.waitForFunction(
      () => globalThis.document.documentElement.dataset.ready !== undefined,
      null,
      { timeout: 120_000 },
    );
    const poses = SWAP_POSES[circuit];
    const swap = await page.evaluate(() => globalThis.__undercut.treeSwap());
    for (const [name, set] of Object.entries(poses)) {
      await page.evaluate(set);
      const shots = [];
      for (const d of [swap, 0]) {
        await page.evaluate((v) => {
          globalThis.__undercut.treeSwap(v);
          globalThis.__undercut.resetFrameTimes();
        }, d);
        await page.waitForFunction(() => (globalThis.__undercut.frameTimes().length ?? 0) >= 20);
        const png = await page
          .locator('#view')
          .screenshot({ style: '#app, .ut-touch { visibility: hidden; }' });
        fs.writeFileSync(path.join(outDir, `tree-swap-${label}-${name}-${d}.png`), png);
        shots.push(png.toString('base64'));
      }
      await page.evaluate((v) => globalThis.__undercut.treeSwap(v), swap);
      const m = await page.evaluate(async ([a, b]) => {
        const read = async (b64) => {
          const img = new globalThis.Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const canvas = new globalThis.OffscreenCanvas(img.width, img.height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, img.width, img.height).data;
        };
        const pa = await read(a);
        const pb = await read(b);
        let sa = 0;
        let sb = 0;
        let n = 0;
        for (let i = 0; i < pa.length; i += 4) {
          const la = 0.2126 * pa[i] + 0.7152 * pa[i + 1] + 0.0722 * pa[i + 2];
          const lb = 0.2126 * pb[i] + 0.7152 * pb[i + 1] + 0.0722 * pb[i + 2];
          if (Math.abs(la - lb) < 6) continue;
          sa += la;
          sb += lb;
          n++;
        }
        return { near: n ? sa / n : 0, cards: n ? sb / n : 0, changed: n / (pa.length / 4) };
      }, shots);
      const ratio = m.cards > 0 ? m.near / m.cards : 1;
      cases.push({
        tod: label,
        pose: name,
        swap,
        nearLuma: +m.near.toFixed(1),
        cardLuma: +m.cards.toFixed(1),
        ratio: +ratio.toFixed(3),
        changedPct: +(m.changed * 100).toFixed(1),
      });
    }
    await page.evaluate(() => globalThis.__undercut.quit());
    await context.close();
  }
  const ok =
    problems.length === 0 &&
    cases.length === 4 &&
    cases.every((c) => c.swap > 0 && Math.abs(c.ratio - 1) <= TREE_SWAP_TOLERANCE);
  report.treeSwapCheck = { ok, tolerance: TREE_SWAP_TOLERANCE, cases, problems };
  for (const c of cases)
    console.log(
      `  tree-swap ${c.tod} ${c.pose}: near ${c.nearLuma} vs cards ${c.cardLuma} (x${c.ratio}, ${c.changedPct}% of pixels change)`,
    );
  console.log(`  tree-swap-check (high, GPU): ${ok ? 'ok' : 'FAILED'}`);
  if (!ok) report.errors.push(`Tree swap check failed: ${JSON.stringify(report.treeSwapCheck)}`);
}

async function skyCheck(browser, report) {
  const hideFloatTargets = () => {
    const hidden = new Set(['EXT_color_buffer_float', 'EXT_color_buffer_half_float']);
    const proto = globalThis.WebGL2RenderingContext.prototype;
    const getExtension = proto.getExtension;
    proto.getExtension = function (name) {
      return hidden.has(name) ? null : getExtension.call(this, name);
    };
    const supported = proto.getSupportedExtensions;
    proto.getSupportedExtensions = function () {
      return (supported.call(this) ?? []).filter((n) => !hidden.has(n));
    };
  };
  const problems = [];
  const measure = async (hideFloat) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await onCircuit(context);
    const page = await context.newPage();
    page.on('console', (m) => {
      if (['error', 'warning'].includes(m.type())) problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(e.message));
    if (hideFloat) await page.addInitScript(hideFloatTargets);
    await page.goto(`http://127.0.0.1:${PORT}/?debug=1&quality=high`);
    await page.waitForFunction(() => Boolean(globalThis.__undercut));
    await page.evaluate(() => globalThis.__undercut.start());
    await page.waitForFunction(
      () => globalThis.document.documentElement.dataset.ready !== undefined,
    );
    await page.evaluate(() => {
      const u = globalThis.__undercut;
      u.camera('chase-near');
      u.restartLap();
      u.setTimeScale(0);
      u.resetFrameTimes();
    });
    await page.waitForFunction(() => (globalThis.__undercut.frameTimes().length ?? 0) >= 15);
    const renderPath = await page.evaluate(() => globalThis.__undercut.renderStats().renderPath);
    const png = await page
      .locator('#view')
      .screenshot({ style: '#app, .ut-touch { visibility: hidden; }' });
    const luma = await page.evaluate(async (b64) => {
      const img = new globalThis.Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = new globalThis.OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const x0 = Math.floor(img.width * 0.25);
      const w = Math.max(1, Math.floor(img.width * 0.5));
      const h = Math.max(1, Math.floor(img.height * 0.15));
      const { data } = ctx.getImageData(x0, 0, w, h);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
      return sum / (data.length / 4);
    }, png.toString('base64'));
    await page.evaluate(() => globalThis.__undercut.quit());
    await context.close();
    return { renderPath, luma };
  };
  const hdr = await measure(false);
  const direct = await measure(true);
  const filteredProblems = problems.filter(
    (p) => !p.includes('EXT_color_buffer_float extension not supported'),
  );
  const relDiff = hdr.luma > 0 ? Math.abs(direct.luma - hdr.luma) / hdr.luma : 1;
  const ok =
    hdr.renderPath === 'hdr' &&
    direct.renderPath === 'direct' &&
    hdr.luma > 40 &&
    relDiff < 0.05 &&
    filteredProblems.length === 0;
  report.skyCheck = {
    quality: 'high',
    ok,
    hdr: +hdr.luma.toFixed(2),
    direct: +direct.luma.toFixed(2),
    relDiffPct: +(relDiff * 100).toFixed(2),
    paths: { hdr: hdr.renderPath, direct: direct.renderPath },
    problems: filteredProblems,
  };
  console.log(
    `  sky-check (high, GPU): ${ok ? 'ok' : 'FAILED'} hdr=${hdr.luma.toFixed(1)} direct=${direct.luma.toFixed(1)} diff=${(relDiff * 100).toFixed(2)}%`,
  );
  if (!ok) report.errors.push(`High sky check failed: ${JSON.stringify(report.skyCheck)}`);
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
    if (flag('mobile-ui')) await mobileUi(browser, report);
    if (!flag('no-shots')) await shots(browser, report);
    if (flag('lap')) await lap(browser, report);
    if (flag('moving')) await moving(browser, report);
    if (flag('lifecycle')) await lifecycle(browser, report);
    if (flag('sky-check')) await skyCheck(browser, report);
    if (flag('tree-swap-check')) await treeSwapCheck(browser, report);
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
