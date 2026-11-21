/* global document, window */
// Captures the car in the three.js viewer with Playwright's Chromium on the GPU.
// Run under the shared GPU lock:
//   flock ~/.cache/undercut/gpu.lock npm run car:preview [-- --out <dir>] [-- --only <name,...>]
// Writes JPEG stills (1440x900) to docs/evidence/m2-car/threejs by default.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { startServer } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const outDir = path.resolve(root, arg('--out', 'docs/evidence/m2-car/threejs'));
const only = arg('--only', '')?.split(',').filter(Boolean) ?? [];
const teams = JSON.parse(fs.readFileSync(path.join(root, 'design/teams.json'), 'utf8')).teams;

const shots = [];
for (const t of teams) shots.push({ name: `livery_${t.id}`, q: { team: t.id, view: 'front34' } });
for (const v of ['front34', 'rear34', 'side', 'top', 'front']) {
  shots.push({ name: `calder_${v}`, q: { team: 'calder', view: v } });
}
shots.push({ name: 'closeup_front_wing', q: { team: 'calder', view: 'wing' } });
shots.push({ name: 'closeup_cockpit', q: { team: 'calder', view: 'cockpit' } });
shots.push({ name: 'mobile_chase', q: { team: 'kestrel', view: 'chase', lod: 'mobile' } });
shots.push({ name: 'far_chase', q: { team: 'kestrel', view: 'chase', lod: 'far' } });
shots.push({
  name: 'pose_steer_drs_bump_glow',
  q: {
    team: 'meridian',
    view: 'front34',
    steer: 18,
    drs: 1,
    travel: 0.025,
    glow: 0.8,
    rain: 1,
    compound: 'soft',
  },
});
shots.push({
  name: 'pose_rear_drs_open',
  q: { team: 'meridian', view: 'rear34', drs: 1, rain: 1 },
});

fs.mkdirSync(outDir, { recursive: true });
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('page:', m.text());
  });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  const gpu = await (async () => {
    await page.goto(base + 'tools/car/preview/index.html?view=front34');
    return page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
  })();
  console.log(`renderer: ${gpu}`);
  for (const s of shots) {
    if (only.length && !only.includes(s.name)) continue;
    const qs = new URLSearchParams(Object.entries(s.q).map(([k, v]) => [k, String(v)]));
    await page.goto(`${base}tools/car/preview/index.html?${qs}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    await page.waitForTimeout(150);
    const stats = await page.evaluate(() => window.__stats());
    const file = path.join(outDir, `${s.name}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    console.log(
      `${s.name}: ${stats.calls} draw calls, ${stats.triangles} triangles -> ${path.relative(root, file)}`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
