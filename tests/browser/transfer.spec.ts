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
