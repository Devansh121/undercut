/* global window, document */
import fs from 'node:fs';
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
} finally {
  await browser.close();
  await server.close();
}
