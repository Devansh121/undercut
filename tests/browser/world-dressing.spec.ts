import { expect, test } from '@playwright/test';

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

  await page.goto('/?quality=mobile&debug=1');
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });

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

  expect(errors).toEqual([]);
});
