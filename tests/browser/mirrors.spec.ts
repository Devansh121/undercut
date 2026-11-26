import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { build } from 'vite';
import { expect, test } from './base';

// Bundle a tiny isolated scene, not a second game session or a High circuit on SwiftShader.
// The fixture exercises the production mirror shader/camera and sky callback on shipped glass.
let script: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.resolve('tests/browser/scenes/mirrors.ts'),
        formats: ['es'],
        name: 'mirrorRegression',
      },
    },
  });
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!bundle || !('output' in bundle)) throw new Error('Missing mirror scene bundle');
  script = bundle.output
    .filter((o) => o.type === 'chunk')
    .map((o) => o.code)
    .join('\n');
});

test('both mirrors cover their glass, show following cars, and keep the sky at the world eye', async ({
  page,
}, info) => {
  page.on('pageerror', (e) => console.log('fixture error', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('fixture console', m.text());
  });
  await page.route('**/mirror-regression', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body></body></html>',
    }),
  );
  await page.goto('/mirror-regression');
  await page.route('**/mirror-regression.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: script,
    }),
  );
  const result = await page.evaluate(async () => {
    const url = '/mirror-regression.js';
    const fixture = (await import(url)) as {
      run(): Promise<{
        trafficImage: string;
        coverage: number[];
        traffic: number[];
        skyDistance: number;
        skyError: number;
      }>;
    };
    return fixture.run();
  });
  const { trafficImage, ...metrics } = result;
  console.log('mirror regression', metrics);
  const imagePath = info.outputPath('following-cars.png');
  await writeFile(imagePath, Buffer.from(trafficImage.split(',')[1]!, 'base64'));
  await info.attach('following-cars', { path: imagePath, contentType: 'image/png' });
  expect.soft(result.coverage).toEqual([1, 1]);
  for (const pixels of result.traffic) expect.soft(pixels).toBeGreaterThan(10);
  expect.soft(result.skyDistance).toBeLessThan(1e-6);
  expect.soft(result.skyError).toBeLessThanOrEqual(1);
  await page.goto('about:blank');
});
