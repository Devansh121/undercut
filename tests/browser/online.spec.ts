import type { Page } from '@playwright/test';
import { expect, test } from './base';
import { openMenu } from './helpers';
import { DEFAULT_CIRCUIT } from '@undercut/protocol';

// Keep DOM/network traces; continuous raster captures compete with two software renderers.
// Explicit lobby/lights/track screenshots below supply the visual evidence.
test.use({ trace: { mode: 'retain-on-failure', screenshots: false } });

test('two players race, rematch, leave and migrate the host', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'One two-context test includes the phone guest');
  test.setTimeout(180_000);
  const hostContext = await browser.newContext({
    baseURL: baseURL!,
    viewport: { width: 1440, height: 900 },
  });
  const guestContext = await browser.newContext({
    baseURL: baseURL!,
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors: string[] = [];
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
  const state = (p: Page) => p.evaluate(() => window.__undercut!.online());
  try {
    await host.goto('/?debug=1&quality=lite');
    // Online Rooms is a mode of the main menu; its start button opens the lobby.
    await openMenu(host);
    await host.locator('[data-action=mode-online]').click();
    await host.locator('[data-action=start]').click();
    await host.getByLabel('Driver name').fill('Host');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect(host.getByTestId('invite')).toBeVisible();
    const invite = await host.getByTestId('invite').getAttribute('href');
    await guest.goto(invite! + '&debug=1&quality=lite');
    await guest.getByLabel('Driver name').fill('Guest');
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect.poll(async () => (await state(host)).state?.members.length).toBe(2);
    await host.getByLabel('Laps', { exact: true }).fill('1');
    expect((await state(host)).state!.room!.settings.circuit).toEqual(DEFAULT_CIRCUIT);
    // Shorten only the lap timing floor for this 1-lap test segment (lengthM stays Monza's so
    // snapshot-distance validation at the real timing line runs unchanged).
    const shortCircuit = { ...DEFAULT_CIRCUIT, minLapMs: 2000, minSectorMs: [] };
    expect(
      await host.evaluate(
        (circuit) => window.__undercut!.onlineSettings({ circuit }),
        shortCircuit,
      ),
    ).toBe(true);
    await expect
      .poll(async () => (await state(host)).state?.room?.settings.circuit.minLapMs)
      .toBe(2000);
    await host.screenshot({ path: info.outputPath('lobby-desktop.png') });
    await guest.screenshot({ path: info.outputPath('lobby-phone.png') });
    await guest.getByRole('button', { name: 'Ready', exact: true }).click();
    await host.getByRole('button', { name: 'Ready to start', exact: true }).click();
    await Promise.all(
      (
        [
          [host, 'desktop'],
          [guest, 'phone'],
        ] as const
      ).map(async ([page, label]) => {
        await expect(page.locator('.online-lights__lamp.is-lit').first()).toBeVisible({
          timeout: 90_000,
        });
        await expect(page.locator('.online-race__net')).toBeHidden();
        await page.screenshot({ path: info.outputPath('lights-' + label + '.png') });
      }),
    );
    for (const page of [host, guest]) {
      await expect
        .poll(async () => (await state(page)).race?.released, { timeout: 90_000 })
        .toBe(true);
      await expect(page.locator('.online-lights')).toBeHidden();
      await expect(page.locator('.online-standing')).toBeVisible();
    }
    const a = (await state(host)).race!;
    const b = (await state(guest)).race!;
    expect(a.start!.lightsOutAt).toBe(b.start!.lightsOutAt);
    expect(Math.abs(a.releasedSimEpoch! - b.releasedSimEpoch!)).toBeLessThanOrEqual(
      a.clockErrorMs! + b.clockErrorMs! + 1000 / 240,
    );
    for (const r of [a, b]) {
      expect(r.releasedServerAt!).toBeGreaterThanOrEqual(r.start!.lightsOutAt);
      expect(r.releasedServerAt! - r.start!.lightsOutAt).toBeLessThan(1000 / 240);
    }
    console.log('Online clock agreement', JSON.stringify({ host: a, guest: b }));
    // Drive through the line only after the normal physical timing floor has elapsed.
    const floor = (await state(host)).state!.room!.settings.circuit.minLapMs;
    await expect
      .poll(async () => (await state(host)).race?.elapsedRaceMs ?? 0, { timeout: 90_000 })
      .toBeGreaterThan(floor + 1000);
    for (const [page, label] of [
      [host, 'desktop'],
      [guest, 'phone'],
    ] as const) {
      await expect.poll(async () => (await state(page)).race?.remote.length).toBe(1);
      await page.screenshot({ path: info.outputPath('track-' + label + '.png') });
      await page.evaluate(() => {
        window.__undercut!.teleport(5460, 0, 180);
        window.__undercut!.drive({ throttle: 0.3 });
      });
      await expect
        .poll(async () => (await state(page)).race?.claims.length, { timeout: 20_000 })
        .toBe(1);
      await expect.poll(async () => (await state(page)).race?.timing[0]?.status).toBe('accepted');
    }
    for (const page of [host, guest])
      await expect(page.getByTestId('online-results')).toBeVisible({ timeout: 30_000 });
    expect((await state(host)).state?.results).toEqual((await state(guest)).state?.results);
    expect((await state(host)).state?.results?.rows.map((r) => r.name)).toEqual(['Host', 'Guest']);
    await host.getByRole('button', { name: 'Rematch', exact: true }).click();
    await expect(guest.getByRole('button', { name: 'Ready', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: 'Leave room', exact: true }).click();
    await expect.poll(async () => (await state(host)).state?.members.length).toBe(1);
    // Rejoin to observe host migration, then leave the last seat too.
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect.poll(async () => (await state(host)).state?.members.length).toBe(2);
    await host.getByRole('button', { name: 'Leave room', exact: true }).click();
    await expect.poll(async () => (await state(guest)).state?.isHost).toBe(true);
    await guest.getByRole('button', { name: 'Leave room', exact: true }).click();
    expect(errors).toEqual([]);
  } catch (error) {
    console.log(
      'Online failure',
      JSON.stringify({ host: await state(host), guest: await state(guest), errors }),
    );
    throw error;
  } finally {
    // Unload both pages first: closing a context that still holds a live software WebGL context
    // stalls Chromium's GPU process for the next test (see base.ts).
    for (const page of [host, guest]) await page.goto('about:blank').catch(() => undefined);
    await hostContext.close();
    await guestContext.close();
  }
});
