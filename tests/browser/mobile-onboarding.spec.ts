import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';

async function overlaps(a: Locator, b: Locator): Promise<boolean> {
  const [p, q] = [await a.boundingBox(), await b.boundingBox()];
  if (!p || !q) return false;
  return p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
}

test('first-lap coach advances by driving, keeps the timing clear, and is skipped from pause', async ({
  drive,
}, info) => {
  const { page } = drive;
  const phone = info.project.name === 'phone';
  const intro = page.getByTestId('onboarding');
  const pause = page.getByTestId('pause-menu');
  await page.evaluate(() => window.__undercut!.pause());
  // A finished coach offers Replay, a running one Skip; never both.
  if (await pause.locator('[data-action=skip-intro]').isVisible())
    await pause.locator('[data-action=skip-intro]').click();
  await expect(pause.locator('[data-action=skip-intro]')).toBeHidden();
  await pause.locator('[data-action=replay-intro]').click();
  await expect(intro).toBeVisible();
  await expect(intro).toContainText('1/4');

  // The coach sits clear of the lap timer, the sectors and the invalid-lap flag (shown here
  // for the measurement, as on an invalid lap).
  const clear = await page.evaluate(() => {
    const flag = document.querySelector('[data-testid=lap-invalid]')!;
    const coach = document.querySelector('[data-testid=onboarding]')!.getBoundingClientRect();
    const was = flag.classList.contains('is-on');
    flag.classList.add('is-on');
    const f = flag.getBoundingClientRect();
    flag.classList.toggle('is-on', was);
    const apart = (a: DOMRect, b: DOMRect): boolean =>
      a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
    return f.width > 0 && apart(coach, f);
  });
  expect(clear).toBe(true);
  expect(await overlaps(intro, page.locator('.hud-timing'))).toBe(false);

  // Driving moves the first tip on; no click needed (a gamepad player has nothing to click).
  await page.evaluate(() => window.__undercut!.drive({ throttle: 1 }));
  await expect(intro).toContainText('driving line turns red', { timeout: 15_000 });
  await page.evaluate(() => window.__undercut!.drive(null));

  if (phone) {
    // Touches pass through the card to the steering zone; Skip is in the pause menu.
    expect(await intro.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    await expect(intro.locator('[data-action=intro-skip]')).toBeHidden();
    await page.evaluate(() => window.__undercut!.pause());
    await pause.locator('[data-action=skip-intro]').click();
  } else {
    await intro.locator('[data-action=intro-skip]').click();
    await page.evaluate(() => window.__undercut!.pause());
  }
  await expect(intro).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('onboarding.v1'))).toBe('done');
  await expect(pause.locator('[data-action=skip-intro]')).toBeHidden();
  await expect(pause.locator('[data-action=replay-intro]')).toBeVisible();
  // The driving actions stay in view above the settings rows.
  for (const action of ['resume', 'restart', 'reset', 'controls'])
    await expect(pause.locator(`[data-action=${action}]`)).toBeInViewport({ ratio: 1 });
  if (phone) {
    const fullscreen = await page.evaluate(() => Boolean(document.fullscreenEnabled));
    await expect(pause.locator('[data-action=fullscreen]')).toBeVisible({ visible: fullscreen });
  }
});

test('safe phone rotation with touch controls sized for thumbs', async ({ drive }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  const { page } = drive;
  const controls = page.locator('.ut-touch [data-control]');
  // The compact phone HUD has no camera button (the camera is in the pause menu).
  await expect(page.locator('.ut-touch [data-control=camera]')).toBeHidden();
  await expect(page.locator('.ut-touch [data-control=pause]')).toBeVisible();
  for (const control of await controls.filter({ visible: true }).all()) {
    const rect = await control.boundingBox();
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.locator('#view').evaluate((e) => getComputedStyle(e).touchAction)).toBe('none');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('rotate-prompt')).toBeVisible();
  expect(await page.getByTestId('pause-menu').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await expect(page.locator('html')).toHaveAttribute('data-paused', '');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByTestId('rotate-prompt')).toBeHidden();
  await expect(page.getByTestId('pause-menu')).toBeVisible();
});

test('pause settings persist and reset to device defaults', async ({ drive }) => {
  const { page } = drive;
  await page.evaluate(() => window.__undercut!.pause());
  await page.locator('[data-setting=units] [data-value=mph]').click();
  expect(await page.evaluate(() => localStorage.getItem('settings.units'))).toBe('mph');
  // The cockpit's steering-wheel display follows the unit too.
  await page.evaluate(() => {
    window.__undercut!.resume();
    window.__undercut!.camera('cockpit');
  });
  await expect.poll(() => page.evaluate(() => window.__undercut!.dashboard()?.unit)).toBe('MPH');
  await page.evaluate(() => window.__undercut!.pause());
  await page.locator('[data-action=reset-settings]').click();
  await expect(page.locator('[data-setting=units] [data-value=kmh]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('[data-setting=quality] [data-value=auto]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
