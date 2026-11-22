/* global window */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

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
const results = {};
try {
  for (const light of ['overcast', 'afternoon', 'night']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => {
      throw e;
    });
    await page.goto(`${server.resolvedUrls.local[0]}tools/props/index.html?light=${light}`);
    await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
    results[light] = {};
    for (const id of ['forest-spruce', 'forest-fir']) {
      const samples = await page.evaluate((id) => window.treeLuma(id), id);
      const worst = samples.reduce((a, b) => (a.relativeDelta > b.relativeDelta ? a : b));
      results[light][id] = {
        samples,
        assetSha256: crypto
          .createHash('sha256')
          .update(fs.readFileSync(`apps/web/public/assets/props/${id}_far.glb`))
          .digest('hex'),
        maxRelativeDelta: worst.relativeDelta,
        worstAngleDeg: Math.round((worst.angle * 180) / Math.PI),
      };
      await page.evaluate(([id, angle]) => window.treeLuma(id, angle), [id, worst.angle]);
      await page.screenshot({
        path: `docs/evidence/m2-models/${id}-${light}-worst-tone.jpg`,
        type: 'jpeg',
        quality: 90,
      });
      console.log(
        `${light} ${id}: ${(100 * worst.relativeDelta).toFixed(2)}% at ${Math.round((worst.angle * 180) / Math.PI)} degrees`,
      );
    }
    await page.close();
  }
  const file = 'docs/evidence/m2-models/forest-sweep.json';
  fs.writeFileSync(
    file,
    await format(JSON.stringify(results), { ...(await resolveConfig(file)), parser: 'json' }),
  );
  if (
    Object.values(results)
      .flatMap(Object.values)
      .some((r) => !Number.isFinite(r.maxRelativeDelta) || r.maxRelativeDelta > 0.15)
  )
    throw new Error('Full forest lighting sweep exceeds 15%');
} finally {
  await browser.close();
  await server.close();
}
