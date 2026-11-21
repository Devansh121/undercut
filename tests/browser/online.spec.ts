import { test, expect, type Page } from '@playwright/test';

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
    await host.getByRole('button', { name: 'Online rooms', exact: true }).click();
    await host.getByLabel('Driver name').fill('Host');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect(host.getByTestId('invite')).toBeVisible();
    const invite = await host.getByTestId('invite').getAttribute('href');
    await guest.goto(invite! + '&debug=1&quality=lite');
    await guest.getByLabel('Driver name').fill('Guest');
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect.poll(async () => (await state(host)).state?.members.length).toBe(2);
    await host.getByLabel('Laps', { exact: true }).fill('1');
    // Keep real server time and the real lap crossing path; shorten only the referee's
    // physical floor because debug placement skips the long middle of the circuit.
    await host.evaluate(() => {
      const circuit = window.__undercut!.online().state!.room!.settings.circuit;
      window.__undercut!.onlineSettings({
        circuit: { ...circuit, minLapMs: 1000, minSectorMs: [] },
      });
    });
    await expect
      .poll(async () => (await state(guest)).state?.room?.settings.circuit.minLapMs)
      .toBe(1000);
    await host.screenshot({ path: info.outputPath('lobby-desktop.png') });
    await guest.screenshot({ path: info.outputPath('lobby-phone.png') });
    await guest.getByRole('button', { name: 'Ready', exact: true }).click();
    await host.getByRole('button', { name: 'Ready to start', exact: true }).click();
    for (const page of [host, guest]) {
      await expect
        .poll(async () => (await state(page)).race?.released, { timeout: 90_000 })
        .toBe(true);
    }
    const a = (await state(host)).race!;
    const b = (await state(guest)).race!;
    expect(a.start!.lightsOutAt).toBe(b.start!.lightsOutAt);
    expect(Math.abs(a.lightsOutLocalEpoch! - b.lightsOutLocalEpoch!)).toBeLessThanOrEqual(
      a.clockErrorMs! + b.clockErrorMs!,
    );
    console.log('Online clock agreement', JSON.stringify({ host: a, guest: b }));
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
      await expect.poll(async () => (await state(page)).race?.timing.length).toBe(1);
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
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
