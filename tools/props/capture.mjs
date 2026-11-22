/* global window, document */
import fs from 'node:fs';
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
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => console.error(e));
  await page.goto(
    `${server.resolvedUrls.local[0]}tools/props/index.html?light=${process.env.PROP_LIGHT ?? 'overcast'}`,
  );
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  // Optional prefix filter (`npm run props:preview -- crew-`) recaptures only those sheets.
  const only = process.argv[2];
  const ids = (await page.evaluate(() => window.catalog.props.map((p) => p.id))).filter(
    (id) => !only || only.split(',').some((prefix) => id.startsWith(prefix)),
  );
  for (const id of ids)
    for (const mode of id.startsWith('crew-') ? ['sheet', 'scale', 'close'] : ['sheet', 'scale']) {
      await page.evaluate(([id, mode]) => window.inspect(id, mode), [id, mode]);
      await page.screenshot({
        path: `docs/evidence/m2-models/${id}-${mode}${process.env.PROP_SUFFIX ?? ''}.jpg`,
        type: 'jpeg',
        quality: 85,
      });
      console.log(`${id} ${mode}`);
    }
  if (ids.some((id) => id.startsWith('forest-'))) {
    const luma = {};
    for (const id of ids.filter((id) => id.startsWith('forest-'))) {
      luma[id] = await page.evaluate((id) => window.treeLuma(id), id);
    }
    const transition = {};
    for (const id of ids.filter((id) => id.startsWith('forest-'))) {
      transition[id] = await page.evaluate((id) => window.treeTransition(id), id);
      await page.screenshot({
        path: `docs/evidence/m2-models/${id}-transition.jpg`,
        type: 'jpeg',
        quality: 88,
        clip: { x: 0, y: 360, width: 1600, height: 640 },
      });
      await page.evaluate(() => document.getElementById('tree-diff')?.remove());
    }
    fs.writeFileSync(
      'docs/evidence/m2-models/forest-transition.json',
      JSON.stringify(transition, null, 2) + '\n',
    );
    fs.writeFileSync(
      'docs/evidence/m2-models/forest-luma.json',
      JSON.stringify(luma, null, 2) + '\n',
    );
    if (
      Object.values(luma)
        .flat()
        .some((r) => !Number.isFinite(r.relativeDelta) || r.relativeDelta > 0.15)
    )
      throw new Error('Tree LOD luminance changes by more than 15%');
    // The Far cards come from the authored triangles: their silhouette must cover about what
    // the Mobile tree covers and overlap it, from every view between the card planes.
    for (const [id, views] of Object.entries(transition))
      for (const v of views)
        if (
          v.coverageMobileOverFar < 0.85 ||
          v.coverageMobileOverFar > 1.2 ||
          v.iouMobileFar < 0.6 ||
          v.iouHighFar < 0.6
        )
          throw new Error(
            `${id}: Far silhouette departs from the authored tree (${JSON.stringify(v)})`,
          );
  }
  if (process.env.PROP_ASSEMBLY) {
    await page.evaluate(
      (forest) => window.kitScene(forest),
      process.env.PROP_ASSEMBLY === 'forest',
    );
    await page.screenshot({
      path: `docs/evidence/m2-models/kit-${process.env.PROP_ASSEMBLY}.jpg`,
      type: 'jpeg',
      quality: 90,
    });
  }
  if (!only) {
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
  }
} finally {
  await browser.close();
  await server.close();
}
