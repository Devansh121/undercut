import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './base';
import { startTimeTrial } from './helpers';

/**
 * The budget check's first-race inventory (apps/web/dist/first-race.json, written by
 * tools/budget/check.mjs) against what a real first race requests, at every circuit: every file
 * the browser fetches is in that circuit's inventory with the same number of body bytes on the
 * wire (compressed where the server compresses), and every asset in it is fetched. Mobile preset;
 * the inventory logic is the same for every preset.
 */
// What is fetched does not depend on the canvas size; software WebGL pays per pixel.
test.use({ viewport: { width: 480, height: 300 } });

type Inventory = Record<string, { total: number; files: Record<string, number> }>;
const inventory = JSON.parse(
  fs.readFileSync(path.resolve('apps/web/dist/first-race.json'), 'utf8'),
) as { presets: Inventory; circuits: Record<string, { presets: Inventory }> };

for (const circuit of ['monza', 'spa', 'singapore']) {
  test(`the budget inventory matches the requests of a real first race at ${circuit}, byte for byte`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
    test.setTimeout(120_000);
    const expected = inventory.circuits[circuit]?.presets.mobile;
    if (!expected) throw new Error(`no ${circuit} mobile preset in first-race.json`);
    if (circuit === 'monza') expect(expected).toEqual(inventory.presets.mobile);
    // The menu's saved circuit, as a player who picked it last time.
    await page.addInitScript((id) => {
      globalThis.localStorage.setItem('menu.prefs', JSON.stringify({ version: 1, circuit: id }));
    }, circuit);
    const fetched = new Map<string, { bytes: number; encoding: string | null }>();
    const pending: Promise<void>[] = [];
    page.on('requestfinished', (request) => {
      const url = new URL(request.url());
      // blob: and data: URLs (images embedded in the car files) never touch the network.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (url.origin !== new URL(page.url() || 'http://127.0.0.1').origin) return;
      if (url.pathname.startsWith('/rooms')) return;
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      pending.push(
        (async () => {
          const sizes = await request.sizes();
          const response = await request.response();
          fetched.set(rel, {
            bytes: sizes.responseBodySize,
            encoding: (await response?.headerValue('content-encoding')) ?? null,
          });
        })(),
      );
    });
    // `world=lite` loads no dressing or prop models; world-dressing.spec.ts checks those against
    // the inventory with the full Mobile world.
    await page.goto('/?quality=mobile&debug=1&world=lite');
    await startTimeTrial(page);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 90_000 });
    await page.waitForTimeout(1500);
    await Promise.all(pending);

    // Everything fetched is accounted for, at the size the check counted.
    for (const [rel, { bytes }] of fetched) {
      expect(expected.files[rel], `${rel} is fetched but not in the inventory`).toBeDefined();
      expect(bytes, `${rel}: bytes on the wire`).toBe(expected.files[rel]);
    }
    // Every asset of the first race is fetched (code chunks that load later may not be yet).
    for (const rel of Object.keys(expected.files)) {
      if (/^assets\/(tex|env|car|draco)\/|^assets\/index\.json$/.test(rel)) {
        expect(fetched.has(rel), `${rel} is in the inventory but was not fetched`).toBe(true);
      }
    }
    // The session was at this circuit: its own track chunk came (others would not be inventoried).
    expect(
      [...fetched.keys()].some((k) => new RegExp(`^assets/${circuit}-[\\w-]+\\.js$`).test(k)),
      `${circuit}'s track chunk was fetched`,
    ).toBe(true);
    // Text really is compressed on the wire.
    expect(fetched.get('index.html')?.encoding).toBe('br');
    const drive = [...fetched.keys()].find((k) => /^assets\/drive-.*\.js$/.test(k));
    expect(drive && fetched.get(drive)?.encoding).toBe('br');
    const total = [...fetched.values()].reduce((a, b) => a + b.bytes, 0);
    expect(total).toBeLessThanOrEqual(expected.total);
    console.log(
      `first race at ${circuit} (mobile): ${fetched.size} requests, ${total} bytes; inventory ${expected.total}`,
    );
  });
}

/**
 * High's own files at a dressed circuit: the High-only levels of the prop models, the High
 * textures, car and sky, and the dressing, which the Lite-world first races above never fetch.
 * CI renders in software and draws only Lite and Mobile, so the session runs on Mobile without
 * its world and the page then downloads (and decodes) what a High session at the circuit would,
 * with the HTTP cache off: every request of that is in the High inventory at the bytes counted,
 * and every asset of it is requested.
 */
test('the High first race at Singapore, with its world, requests what the budget counts', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  test.setTimeout(120_000);
  const expected = inventory.circuits.singapore?.presets.high;
  if (!expected) throw new Error('no singapore high preset in first-race.json');
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      'menu.prefs',
      JSON.stringify({ version: 1, circuit: 'singapore' }),
    );
  });
  // The Mobile session's requests, then the High prefetch's; the page keeps what it downloaded
  // (car levels both presets use come from the first).
  const before = new Set<string>();
  const fetched = new Map<string, number>();
  let phase: 'mobile' | 'high' = 'mobile';
  const pending: Promise<void>[] = [];
  page.on('requestfinished', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(page.url()).origin || !url.pathname.startsWith('/assets/')) return;
    const rel = url.pathname.slice(1);
    if (phase === 'mobile') {
      before.add(rel);
      return;
    }
    pending.push(
      (async () => {
        fetched.set(rel, (await request.sizes()).responseBodySize);
      })(),
    );
  });
  await page.goto('/?quality=mobile&debug=1&world=lite');
  await startTimeTrial(page);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 90_000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  phase = 'high';
  await page.evaluate(() => window.__undercut!.prefetch('high'));
  await Promise.all(pending);

  for (const [rel, bytes] of fetched) {
    expect(expected.files[rel], `${rel} is fetched but not in the High inventory`).toBeDefined();
    expect(bytes, `${rel}: bytes on the wire`).toBe(expected.files[rel]);
  }
  // Livery masks load as the cars are built (the first races above request them), not here.
  const assets = Object.keys(expected.files).filter((f) =>
    /^assets\/(props|tex|env)\/|^assets\/car\/[^/]+\.glb$|^assets\/singapore\.dressing-.*\.json$/.test(
      f,
    ),
  );
  // The High levels of the kit's models are among them.
  expect(assets.some((f) => /^assets\/props\/street-fence_high\.glb$/.test(f))).toBe(true);
  for (const rel of assets)
    expect(
      fetched.has(rel) || before.has(rel),
      `${rel} is in the High inventory but was not fetched`,
    ).toBe(true);
  // What only High has (its levels of the kit, the dressing) came with the prefetch.
  for (const rel of assets.filter((f) => /_high\.glb$|dressing-/.test(f)))
    expect(fetched.has(rel), `${rel} came with the High prefetch`).toBe(true);
  console.log(
    `High at singapore: ${fetched.size} requests; ${assets.length} assets in the inventory`,
  );
});
