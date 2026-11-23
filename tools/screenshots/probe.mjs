// Ad hoc render probe: open the built game on the GPU, run a snippet in the page, screenshot.
//   node tools/screenshots/probe.mjs --quality high --size 1440x900 --out file.png --eval "js"
// Runs under the GPU lock like shots.mjs. For investigations; stations live in shots.mjs.
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const LOCK = path.join(os.homedir(), '.cache/undercut/gpu.lock');
if (!process.env.SHOTS_GPU_LOCKED) {
  const r = spawnSync('flock', [LOCK, process.execPath, fileURLToPath(import.meta.url), ...args], {
    stdio: 'inherit',
    env: { ...process.env, SHOTS_GPU_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}
const PORT = Number(process.env.SHOTS_PORT ?? 4391);
const server = spawn(process.execPath, ['tools/serve/start.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    HTTPS_PORT: String(PORT + 1),
    ROOMS_PORT: String(PORT + 514),
  },
  stdio: 'ignore',
});
try {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const [w, h] = opt('size', '1440x900').split('x').map(Number);
  const browser = await chromium.launch({
    args: [
      '--mute-audio',
      '--use-gl=angle',
      '--use-angle=gl-egl',
      '--ignore-gpu-blocklist',
      '--enable-gpu-rasterization',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: Number(opt('dpr', '1')),
  });
  page.on(
    'console',
    (m) =>
      (m.type() === 'error' || m.type() === 'warning') &&
      console.log(`[${m.type()}] ${m.text().slice(0, 400)}`),
  );
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(
    `http://127.0.0.1:${PORT}/?debug=1&quality=${opt('quality', 'high')}${opt('query', '')}`,
  );
  await page.waitForFunction(() => Boolean(globalThis.__undercut));
  await page.evaluate(() => globalThis.__undercut.start());
  await page.waitForFunction(
    () => globalThis.document.documentElement.dataset.ready !== undefined,
    null,
    { timeout: 90_000 },
  );
  const code = opt('eval', '');
  if (code) {
    const result = await page.evaluate(
      `(async () => { const u = globalThis.__undercut; ${code} })()`,
    );
    if (result !== undefined) console.log(JSON.stringify(result, null, 1));
  }
  await page.waitForTimeout(Number(opt('wait', '800')));
  const out = opt('out', '');
  if (out) await page.screenshot({ path: out });
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
