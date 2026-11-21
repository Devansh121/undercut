import { expect, test } from './base';
import { startTimeTrial } from './helpers';

/**
 * The loading screen: progress by bytes, and when a file fails, a plain message with Try again
 * that fetches only what is missing and then starts the session. One project covers it.
 */
test('a failed download shows Try again, and trying again starts the session', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  let failures = 0;
  // The first request for one texture fails; later ones go through.
  await page.route('**/assets/tex/asphalt/diff_*.webp', async (route) => {
    if (failures === 0) {
      failures++;
      await route.abort('connectionreset');
    } else {
      await route.continue();
    }
  });
  await page.goto('/?debug=1&quality=lite');
  await startTimeTrial(page);
  const loading = page.locator('[data-testid=loading]');
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
  await expect(loading).toContainText(/Could not download tex\/asphalt\/diff_\d+\.webp/);
  await expect(page.locator('.loading__bytes')).toContainText(/MB/);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await expect(loading).toHaveCount(0);
  expect(failures).toBe(1);
  expect(problems).toEqual([]);
});

test('a failed load leaves no decoder workers running, even when other files arrive later', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const counts = { created: 0, terminated: 0 };
    (window as unknown as { __workers: typeof counts }).__workers = counts;
    const Native = window.Worker;
    class Counted extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        counts.created++;
      }
      override terminate(): void {
        counts.terminated++;
        super.terminate();
      }
    }
    window.Worker = Counted;
  });
  // One livery mask fails at once; the car files arrive two seconds later.
  await page.route('**/assets/car/livery/aldermoor.png', (route) => route.abort('connectionreset'));
  await page.route('**/assets/car/*.glb', async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.goto('/?debug=1&quality=lite');
  await startTimeTrial(page);
  const loading = page.locator('[data-testid=loading]');
  await expect(loading).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
  // Long after the delayed files have arrived: every worker that was started has been stopped.
  await page.waitForTimeout(5000);
  const workers = await page.evaluate(
    () => (window as unknown as { __workers: { created: number; terminated: number } }).__workers,
  );
  expect(workers.terminated).toBe(workers.created);
});
