// `npm run audio:browser-check`: builds tools/audio/browser-check with Vite (as the game
// would bundle the worklet), serves it on a free local port and runs it in Playwright's
// Chromium. Needs `npx playwright install chromium` once. Prints the result as JSON and
// exits non-zero if the worklet did not render the engine at the right pitch.
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const out = await mkdtemp(join(tmpdir(), 'audio-browser-check-'));
await build({
  root,
  base: './',
  logLevel: 'warn',
  build: { outDir: out, emptyOutDir: true, target: 'es2022' },
});

const TYPES = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  let path = (req.url ?? '/').split('?')[0];
  if (path === '/') path = '/index.html';
  try {
    const body = await readFile(join(out, decodeURIComponent(path)));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let failed;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(() => globalThis.result);
  console.log(JSON.stringify(result, null, 2));
  const o = result.offline;
  failed =
    !o ||
    !(o.peak > 0.01 && o.peak < 1) ||
    Math.abs(o.firingHz - o.expectedHz) / o.expectedHz > 0.001 ||
    result.live?.statuses?.join(',') !== 'idle,running,suspended,running,silent';
} finally {
  await browser.close();
  server.close();
  await rm(out, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
