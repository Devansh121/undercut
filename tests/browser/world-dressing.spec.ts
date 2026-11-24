import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './base';
import { startTimeTrial } from './helpers';

/**
 * Verifies that circuit dressing loads cleanly in a real browser race session and populates the
 * pit complex, grandstands, crowd, trees, trackside furniture, bridges, and addressable start lights
 * without console or page errors.
 */
test.use({ viewport: { width: 480, height: 300 } });

/**
 * Every named object's `userData.reflect` (world/water.ts), keyed by name without a trailing
 * chunk or crowd-variant number, so chunked meshes of one kind share a key.
 */
async function reflectFlags(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(() => {
    const view = window.__undercut?.view() as {
      scene: {
        traverse(f: (o: { name: string; userData: Record<string, unknown> }) => void): void;
      };
    };
    const out: Record<string, string[]> = {};
    view.scene.traverse((o) => {
      if (!o.name) return;
      const key = o.name.replace(/-\d+$/, '');
      const r = o.userData.reflect;
      const v = typeof r === 'string' ? r : 'none';
      const list = (out[key] ??= []);
      if (!list.includes(v)) list.push(v);
    });
    return out;
  });
}

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

  // The water's reflection draws what each kind is flagged with where it is made
  // (`userData.reflect`, world/water.ts), read back from the built scene kind by kind.
  const reflect = await reflectFlags(page);
  for (const [kind, flag] of Object.entries({
    sky: 'skyline',
    'world:buildings': 'skyline',
    'world:pit-building': 'skyline',
    'world:stands': 'skyline',
    'world:bridges': 'skyline',
    'world:ground': 'scenery',
    track: 'scenery',
    'prop:tree-wood': 'scenery',
    'prop:tree-row': 'scenery',
    'prop:tree-park': 'scenery',
    // Not reflected: small props and the crowd.
    'prop:hoarding-front': 'none',
    'prop:crowd': 'none',
  }))
    expect(reflect[kind], kind).toEqual([flag]);

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

test('loads Singapore: street walls, floodlights, temporary stands and backdrops, its files as the budget counts them', async ({
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
  const expected = inventory.circuits.singapore?.presets.mobile?.files ?? {};
  const fetched = new Map<string, number>();
  const pending: Promise<void>[] = [];
  page.on('requestfinished', (request) => {
    const url = new URL(request.url());
    if (!/^\/assets\/(props\/|[a-z]+\.dressing-|env\/)/.test(url.pathname)) return;
    pending.push(
      (async () => {
        fetched.set(url.pathname.slice(1), (await request.sizes()).responseBodySize);
      })(),
    );
  });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem(
      'menu.prefs',
      JSON.stringify({ version: 1, circuit: 'singapore' }),
    );
  });

  // The menu's first sky at Singapore is the floodlit night.
  await page.goto('/?quality=mobile&debug=1');
  await startTimeTrial(page);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await Promise.all(pending);
  const wanted = Object.keys(expected).filter((f) =>
    /^assets\/(props\/|singapore\.dressing-.*\.json$|env\/)/.test(f),
  );
  expect(wanted.some((f) => f.includes('street-fence'))).toBe(true);
  expect(wanted.some((f) => /^assets\/env\/night\//.test(f))).toBe(true);
  expect([...fetched.keys()].sort()).toEqual(wanted.sort());
  for (const [rel, bytes] of fetched)
    expect(bytes, `${rel}: bytes on the wire`).toBe(expected[rel]);

  const counts = await page.evaluate(() => window.__undercut?.worldCounts() ?? null);
  expect(counts).not.toBeNull();
  // Blocks and fence on every concrete run, a terminal at each open end.
  expect(counts!.streetBlocks).toBeGreaterThan(1000);
  expect(counts!.debrisFences).toBe(counts!.streetBlocks);
  expect(counts!.fenceEnds).toBeGreaterThan(0);
  expect(counts!.fenceEnds! % 2).toBe(0);
  // A mast every 40 m a side by the track's rule, less the pit side by the pit lane.
  expect(counts!.floodlightMasts).toBeGreaterThan(180);
  expect(counts!.localLights).toBeGreaterThan(counts!.floodlightMasts!);
  expect(counts!.tempStands).toBeGreaterThanOrEqual(5);
  expect(counts!.crowd).toBeGreaterThan(200);
  expect(counts!.lightingTrusses).toBeGreaterThan(50);
  expect(counts!.backdrops).toBeGreaterThan(5);
  const reflect = await reflectFlags(page);
  for (const [kind, flag] of Object.entries({
    sky: 'skyline',
    'world:buildings': 'skyline',
    'prop:temporary-stand': 'skyline',
    'prop:floodlight-mast': 'scenery',
    'prop:lighting-truss': 'scenery',
    'prop:street-block': 'scenery',
    'prop:street-fence': 'scenery',
    'world:water': 'none',
  }))
    expect(reflect[kind], kind).toEqual([flag]);
  const backdrops = Object.keys(reflect).filter((k) => k.startsWith('prop:backdrop-'));
  expect(backdrops.length).toBeGreaterThan(0);
  for (const k of backdrops) expect(reflect[k], k).toEqual(['skyline']);
  expect(counts!.water).toBeGreaterThanOrEqual(1);
  // A street circuit has its own walls and fencing: no catch fences or barrier hoardings.
  expect(counts!.catchFences).toBe(0);

  await page.evaluate(() => window.__undercut?.quit());
  await expect(page.getByRole('button', { name: /Start/ })).toBeVisible();
  expect(errors).toEqual([]);
});
