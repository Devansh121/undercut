/* global window, document */
import fs from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  publicDir: 'apps/web/public',
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => console.error(e));
  await page.goto(`${server.resolvedUrls.local[0]}tools/props/index.html`);
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  const ids = await page.evaluate(() => window.catalog.props.map((p) => p.id));
  for (const id of ids)
    for (const mode of ['sheet', 'scale']) {
      await page.evaluate(([id, mode]) => window.inspect(id, mode), [id, mode]);
      await page.screenshot({
        path: `docs/evidence/m2-models/${id}-${mode}.jpg`,
        type: 'jpeg',
        quality: 85,
      });
      console.log(`${id} ${mode}`);
    }
  const boards = [
    'braking-board',
    'zone-board',
    'corner-board',
    'kilometre-board',
    'hoarding',
    'pit-garage',
    'start-gantry',
    'bridge-banner',
    'pedestrian-bridge',
    'screen-tower',
  ];
  for (const id of boards) {
    await page.evaluate((id) => window.artwork(id), id);
    await page.screenshot({
      path: `docs/evidence/m2-models/${id}-artwork.jpg`,
      type: 'jpeg',
      quality: 90,
    });
  }
  await page.evaluate(() => window.corridor());
  await page.screenshot({
    path: 'docs/evidence/m2-models/corridor.jpg',
    type: 'jpeg',
    quality: 90,
  });
  fs.writeFileSync(
    'docs/evidence/m2-models/corridor.json',
    JSON.stringify(await page.evaluate(() => window.corridorStats), null, 2) + '\n',
  );
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return gl.getParameter(e.UNMASKED_RENDERER_WEBGL);
  });
  fs.writeFileSync(
    'docs/evidence/m2-models/capture.json',
    JSON.stringify(
      {
        gpu,
        lighting: 'Environment / MONZA_AFTERNOON / high',
        dimensions: [1600, 1000],
        sheet: 'High top; far bottom; four rotations at 90 degree intervals',
        scale: 'Unscaled 5.6 m car alongside each prop',
        props: ids,
      },
      null,
      2,
    ) + '\n',
  );
  for (const name of ['capture', 'corridor']) {
    const file = `docs/evidence/m2-models/${name}.json`;
    fs.writeFileSync(
      file,
      await format(fs.readFileSync(file, 'utf8'), {
        ...(await resolveConfig(file)),
        parser: 'json',
      }),
    );
  }
} finally {
  await browser.close();
  await server.close();
}
