import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './base';
import { startTimeTrial } from './helpers';

/**
 * Verifies that circuit dressing loads cleanly in a real browser race session and populates the
 * pit complex, grandstands, crowd, trees, trackside furniture, bridges, and addressable start lights
 * without console or page errors.
 */
test.use({ viewport: { width: 480, height: 300 } });

test('loads Monza circuit dressing and places world scenery, pit crew, and furniture', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs once on the desktop project');
  test.setTimeout(90_000);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  // The dressing file and the prop models the world loads, against the budget's first-race
  // inventory (the rest of it is checked by transfer.spec.ts, whose Lite session loads neither).
  const inventory = JSON.parse(
    fs.readFileSync(path.resolve('apps/web/dist/first-race.json'), 'utf8'),
  ) as { presets: Record<string, { files: Record<string, number> }> };
  const expected = inventory.presets.mobile?.files ?? {};
  const props = new Map<string, number>();
  const pending: Promise<void>[] = [];
  page.on('requestfinished', (request) => {
    const url = new URL(request.url());
    if (!/^\/assets\/(props\/|monza\.dressing-)/.test(url.pathname)) return;
    pending.push(
      (async () => {
        props.set(url.pathname.slice(1), (await request.sizes()).responseBodySize);
      })(),
    );
  });

  // The full Mobile world: the one browser test that builds every structure.
  await page.goto('/?quality=mobile&debug=1');
  await startTimeTrial(page);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await Promise.all(pending);
  const wanted = Object.keys(expected).filter((f) =>
    /^assets\/(props\/|monza\.dressing-.*\.json$)/.test(f),
  );
  expect(wanted.length).toBeGreaterThan(0);
  expect([...props.keys()].sort()).toEqual(wanted.sort());
  for (const [rel, bytes] of props) expect(bytes, `${rel}: bytes on the wire`).toBe(expected[rel]);

  const counts = await page.evaluate(() => window.__undercut?.worldCounts() ?? null);
  expect(counts).not.toBeNull();
  expect(counts!.garageBays).toBeGreaterThanOrEqual(20);
  expect(counts!.pitCanopies).toBeGreaterThanOrEqual(10);
  expect(counts!.pitCrew).toBeGreaterThan(20);
  expect(counts!.stands).toBeGreaterThan(5);
  expect(counts!.crowd).toBeGreaterThan(100);
  expect((counts!.treesWood ?? 0) + (counts!.treesRow ?? 0)).toBeGreaterThan(200);
  expect(counts!.hoardings).toBeGreaterThan(40);
  expect(counts!.catchFences).toBeGreaterThan(40);
  expect(counts!.bridges).toBeGreaterThanOrEqual(2);

  // Exercise the addressable start-gantry lights API without throwing.
  await page.evaluate(() => {
    window.__undercut?.setStartLights(0b11111);
    window.__undercut?.setStartLights(32);
    window.__undercut?.setStartLights(0);
  });

  // Quitting releases the world without errors (GL balance with the full world is checked on
  // the GPU by npm run shots -- monza --lifecycle).
  await page.evaluate(() => window.__undercut?.quit());
  await expect(page.getByRole('button', { name: /Start/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('loads Spa: its dressing and prop models as the budget counts them, conifers and kit garages', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs once on the desktop project');
  test.setTimeout(90_000);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  const inventory = JSON.parse(
    fs.readFileSync(path.resolve('apps/web/dist/first-race.json'), 'utf8'),
  ) as { circuits: Record<string, { presets: Record<string, { files: Record<string, number> }> }> };
  const expected = inventory.circuits.spa?.presets.mobile?.files ?? {};
  const fetched = new Map<string, number>();
  const pending: Promise<void>[] = [];
  page.on('requestfinished', (request) => {
    const url = new URL(request.url());
    if (!/^\/assets\/(props\/|[a-z]+\.dressing-)/.test(url.pathname)) return;
    pending.push(
      (async () => {
        fetched.set(url.pathname.slice(1), (await request.sizes()).responseBodySize);
      })(),
    );
  });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem('menu.prefs', JSON.stringify({ version: 1, circuit: 'spa' }));
  });

  await page.goto('/?quality=mobile&debug=1');
  await startTimeTrial(page);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await Promise.all(pending);
  const wanted = Object.keys(expected).filter((f) =>
    /^assets\/(props\/|spa\.dressing-.*\.json$)/.test(f),
  );
  expect(wanted.some((f) => f.includes('hill-pit-garage'))).toBe(true);
  // Mobile draws no near trees: the forest models are not fetched there.
  expect(wanted.some((f) => f.includes('forest-'))).toBe(false);
  expect([...fetched.keys()].sort()).toEqual(wanted.sort());
  for (const [rel, bytes] of fetched)
    expect(bytes, `${rel}: bytes on the wire`).toBe(expected[rel]);

  const counts = await page.evaluate(() => window.__undercut?.worldCounts() ?? null);
  expect(counts).not.toBeNull();
  expect(counts!.pitGarages).toBeGreaterThanOrEqual(20);
  expect(counts!.garageBays).toBe(counts!.pitGarages);
  expect(counts!.treesConifer).toBeGreaterThan(100);
  expect(counts!.stands).toBeGreaterThan(3);
  expect(counts!.crowd).toBeGreaterThan(50);

  await page.evaluate(() => window.__undercut?.quit());
  await expect(page.getByRole('button', { name: /Start/ })).toBeVisible();
  expect(errors).toEqual([]);
});
