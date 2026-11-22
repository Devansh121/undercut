/* global window */
// The forest's LOD gate where Far is actually drawn: Mobile against Far at 250 m and 300 m in the
// full scene, overcast / afternoon / night, a full revolution in 30 degree steps. Every sample must
// hold interior tone, region tone and solid-pixel count within 15%, and coverage within the
// transition gate. `--probe` prints the table without writing evidence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

export const LIMIT = 0.15;
// 35 degrees on a 1000 px viewport samples the tree as the 60 degree chase camera does on a
// 1700 px tall display; `SWAP_FOV=60` measures the chase view at this resolution.
const FOV = Number(process.env.SWAP_FOV ?? 35);
const probe = process.argv.includes('--probe');
const ids = ['forest-spruce', 'forest-fir'];
const lights = (process.env.SWAP_LIGHTS ?? 'overcast,afternoon,night').split(',');
const evidence = 'docs/evidence/m2-models';
const scratch = path.join(os.homedir(), '.cache/undercut/scratch/m2-forest-kit');
fs.mkdirSync(scratch, { recursive: true });
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  root: process.cwd(),
  publicDir: 'apps/web/public',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const deltas = (s) => ({
  interiorDelta: Math.abs(s.interior.far - s.interior.mobile) / s.interior.mobile,
  regionDelta: Math.abs(s.region.far - s.region.mobile) / s.region.mobile,
  solidDelta: Math.abs(s.solid[1] / s.solid[0] - 1),
  coverageRatio: s.coverage[0] / s.coverage[1],
});
const results = {};
let failed = false;
try {
  for (const light of lights) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => {
      throw e;
    });
    await page.goto(`${server.resolvedUrls.local[0]}tools/props/index.html?light=${light}`);
    await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
    results[light] = {};
    for (const id of ids) {
      const samples = [];
      for (let k = 0; k < 12; k++)
        for (const distance of [250, 300]) {
          const s = await page.evaluate(
            ([id, a, d, f]) => window.treeSwap(id, a, d, f),
            [id, (k * Math.PI) / 6, distance, FOV],
          );
          samples.push({ ...s, ...deltas(s) });
        }
      const worst = (key) => samples.reduce((a, b) => (b[key] > a[key] ? b : a));
      const summary = {
        interior: worst('interiorDelta').interiorDelta,
        region: worst('regionDelta').regionDelta,
        solid: worst('solidDelta').solidDelta,
        coverage: [
          Math.min(...samples.map((s) => s.coverageRatio)),
          Math.max(...samples.map((s) => s.coverageRatio)),
        ],
      };
      const fail =
        summary.interior > LIMIT ||
        summary.region > LIMIT ||
        summary.solid > LIMIT ||
        summary.coverage[0] < 0.85 ||
        summary.coverage[1] > 1.2;
      failed ||= fail;
      const pct = (v) => `${(100 * v).toFixed(1)}%`;
      console.log(
        `${light.padEnd(9)} ${id.padEnd(13)} interior ${pct(summary.interior)}  region ${pct(summary.region)}  solid ${pct(summary.solid)}  coverage ${summary.coverage.map((v) => v.toFixed(2)).join('-')}${fail ? '  FAIL' : ''}`,
      );
      if (process.env.SWAP_DETAIL)
        for (const s of samples)
          console.log(
            `   ${String(Math.round((s.angle * 180) / Math.PI)).padStart(3)} ${s.distance}  interior ${((s.interior.far / s.interior.mobile - 1) * 100).toFixed(0)}%  region ${((s.region.far / s.region.mobile - 1) * 100).toFixed(0)}%  solid ${s.solid.join('/')}  cov ${s.coverage.join('/')}`,
          );
      results[light][id] = {
        files: Object.fromEntries(
          ['mobile', 'far'].map((lod) => {
            const file = `apps/web/public/assets/props/${id}_${lod}.glb`;
            return [lod, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
          }),
        ),
        worst: summary,
        samples,
      };
      if (!probe) {
        // Mobile | Far at the worst-region azimuth, 250 m, cropped and enlarged 4x (nearest).
        const w = worst('regionDelta');
        const crops = [];
        for (const level of [0, 1]) {
          await page.evaluate(([id, a, f]) => window.treeSwap(id, a, 250, f), [id, w.angle, FOV]);
          await page.evaluate(([l, f]) => window.treeSwapShow(l, f), [level, FOV]);
          const file = path.join(scratch, `swap-${level}.png`);
          await page.screenshot({ path: file, clip: { x: 760, y: 440, width: 80, height: 120 } });
          crops.push(file);
        }
        execFileSync('ffmpeg', [
          '-loglevel',
          'error',
          '-y',
          ...crops.flatMap((f) => ['-i', f]),
          '-filter_complex',
          '[0]scale=iw*4:ih*4:flags=neighbor[a];[1]scale=iw*4:ih*4:flags=neighbor[b];[a][b]hstack=2',
          `${evidence}/${id}-${light}-swap.png`,
        ]);
      }
    }
    await page.close();
  }
  if (!probe) {
    const file = `${evidence}/forest-swap.json`;
    fs.writeFileSync(
      file,
      await format(JSON.stringify(results), { ...(await resolveConfig(file)), parser: 'json' }),
    );
  }
  if (failed) throw new Error(`Forest LOD swap exceeds ${LIMIT * 100}%`);
} finally {
  await browser.close();
  await server.close();
}
