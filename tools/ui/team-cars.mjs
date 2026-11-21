// Studio images of every team's car for the main menu's team card: the real car model in each
// driver's livery, rendered by the car viewer (tools/car/preview) on the GPU and encoded as WebP.
//
//   npm run ui:cars                 every team and driver
//   npm run ui:cars -- --only calder
//
// Writes apps/web/public/assets/ui/cars/<team>-<1|2>.webp and updates their entries in
// assets/MANIFEST.json. Runs itself under the shared GPU lock (~/.cache/undercut/gpu.lock).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startServer } from '../car/preview/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);

const LOCK = path.join(os.homedir(), '.cache/undercut/gpu.lock');
if (!process.env.UI_CARS_GPU_LOCKED) {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const r = spawnSync('flock', [LOCK, process.execPath, fileURLToPath(import.meta.url), ...args], {
    stdio: 'inherit',
    env: { ...process.env, UI_CARS_GPU_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}

const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? (args[onlyAt + 1] ?? '').split(',') : [];
const outRel = 'apps/web/public/assets/ui/cars';
const outDir = path.join(root, outRel);
fs.mkdirSync(outDir, { recursive: true });
const teams = JSON.parse(fs.readFileSync(path.join(root, 'design/teams.json'), 'utf8')).teams;

// The card's background (--c-ink-0) and a ground a step lighter, so the image sits in the card.
const BG = '0b0c0e';
const GROUND = '16181b';
const SIZE = { width: 960, height: 420 };
const QUALITY = 0.82;

const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const written = [];
try {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  for (const t of teams) {
    if (only.length && !only.includes(t.id)) continue;
    for (const driver of [0, 1]) {
      const q = new URLSearchParams({
        team: t.id,
        driver: String(driver),
        view: 'card',
        bg: BG,
        ground: GROUND,
        fog: '8,15',
        exposure: '1.05',
        steer: '-6',
      });
      await page.goto(`${base}tools/car/preview/index.html?${q}`);
      await page.waitForFunction(() => globalThis.__ready === true, null, { timeout: 60_000 });
      await page.waitForTimeout(150);
      const data = await page.evaluate(
        (quality) => globalThis.document.querySelector('canvas').toDataURL('image/webp', quality),
        QUALITY,
      );
      const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
      const name = `${t.id}-${driver + 1}.webp`;
      fs.writeFileSync(path.join(outDir, name), bytes);
      written.push(`${outRel}/${name}`);
      console.log(`${name}: ${(bytes.length / 1024).toFixed(1)} KiB`);
    }
  }
} finally {
  await browser.close();
  server.close();
}

// Asset manifest: generated in this repository from the car model, MIT like the code.
const manifestPath = path.join(root, 'assets/MANIFEST.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const file of written) {
  const sha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, file)))
    .digest('hex');
  const entry = {
    file,
    source_url: 'tools/ui/team-cars.mjs (this repository)',
    author: 'Project contributors',
    licence: 'MIT',
    changes:
      'Rendered from apps/web/public/assets/car/car_high.glb in the team livery by the car viewer (tools/car/preview), 960 x 420, WebP quality 82',
    sha256,
  };
  const i = manifest.findIndex((e) => e.file === file);
  if (i >= 0) manifest[i] = entry;
  else manifest.push(entry);
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${written.length} images, manifest updated`);
