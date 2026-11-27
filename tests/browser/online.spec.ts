import type { Page } from '@playwright/test';
import { expect, test } from './base';
import { openMenu } from './helpers';
import { DEFAULT_CIRCUIT } from '@undercut/protocol';

// Keep DOM/network traces; continuous raster captures compete with two software renderers.
// The lobby screenshots below are the visual evidence. Nothing is captured once the race is on:
// on software WebGL one screenshot holds a page's frame loop for 5 to 13 s, longer than the start
// lights (about 3.5 s), than the 6 s of silence after which the room marks a racing driver away
// (and hands a silent host's role to a guest), and most of the 15 s finish window.
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
  // The start lights are on for about 3.5 s, often while the page is busy. A browser-side
  // observer records the most lit lamps ever visible on screen, so the check after the release
  // sees what was displayed (a lamp in a hidden or detached HUD does not count).
  const watchLamps = (p: Page) =>
    p.evaluate(() => {
      const w = window as unknown as { litLampsSeen: number };
      w.litLampsSeen = 0;
      const count = (): void => {
        let n = 0;
        for (const lamp of document.querySelectorAll('.online-lights__lamp.is-lit')) {
          const box = lamp.getBoundingClientRect();
          const shown = lamp.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
          if (shown && box.width > 0 && box.height > 0) n++;
        }
        w.litLampsSeen = Math.max(w.litLampsSeen, n);
      };
      new MutationObserver(count).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'hidden', 'style'],
      });
    });
  const litLampsSeen = (p: Page) =>
    p.evaluate(() => (window as unknown as { litLampsSeen: number }).litLampsSeen);
  // Who each page is, as the room reports it.
  const members = async (p: Page) =>
    ((await state(p)).state?.members ?? []).map((m) => m.name + (m.you ? ' (you)' : '')).sort();
  try {
    await host.goto('/?debug=1&quality=lite');
    // Online Rooms is a mode of the main menu; its start button opens the lobby.
    await openMenu(host);
    await host.locator('[data-action=mode-online]').click();
    await host.locator('[data-action=start]').click();
    await host.getByLabel('Driver name').fill('Host');
    await expect(host.getByLabel('Driver name')).toHaveValue('Host');
    await host.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect(host.getByTestId('invite')).toBeVisible();
    const invite = await host.getByTestId('invite').getAttribute('href');
    await guest.goto(invite! + '&debug=1&quality=lite');
    await guest.getByLabel('Driver name').fill('Guest');
    await expect(guest.getByLabel('Driver name')).toHaveValue('Guest');
    await guest.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect.poll(async () => (await state(host)).state?.members.length).toBe(2);
    await expect.poll(() => members(host)).toEqual(['Guest', 'Host (you)']);
    await expect.poll(() => members(guest)).toEqual(['Guest (you)', 'Host']);
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
    for (const page of [host, guest]) await watchLamps(page);
    await guest.getByRole('button', { name: 'Ready', exact: true }).click();
    await host.getByRole('button', { name: 'Ready to start', exact: true }).click();
    // Wait for the release, which stays true, then read what the observers saw during the lights.
    for (const page of [host, guest]) {
      await expect
        .poll(async () => (await state(page)).race?.released, { timeout: 90_000 })
        .toBe(true);
      expect(await litLampsSeen(page)).toBeGreaterThanOrEqual(1);
      await expect(page.locator('.online-race__net')).toBeHidden();
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
    for (const page of [host, guest]) {
      await expect.poll(async () => (await state(page)).race?.lapTimeSec ?? 0).toBeGreaterThan(0.5);
      await expect(page.locator('.hud')).toContainText('Host');
      await expect(page.locator('.hud')).toContainText('Guest');
      await expect(page.locator('.hud')).not.toContainText('Out lap');
    }
    // Every shader is compiled before the lights: a first compile mid-race holds the page (a
    // synchronous link check waits for the GPU queue) for seconds on software WebGL. Checked again
    // once the host's lap is in: the cars are far apart by then (the remote car is at `far`), and
    // both views are still up (they close with the results).
    const programs = (p: Page) => p.evaluate(() => window.__undercut!.rendererInfo().programs);
    const programsAtStart = [await programs(host), await programs(guest)];
    // Drive through the line only after the normal physical timing floor has elapsed.
    const floor = (await state(host)).state!.room!.settings.circuit.minLapMs;
    await expect
      .poll(async () => (await state(host)).race?.elapsedRaceMs ?? 0, { timeout: 90_000 })
      .toBeGreaterThan(floor + 1000);
    for (const page of [host, guest])
      await expect.poll(async () => (await state(page)).race?.remote.length).toBe(1);
    // Host first, so the result order is known. The host's crossing opens the 15 s finish window,
    // so the guest sets off as soon as the host's lap is in, with nothing slow in between.
    //
    // Placed 112.5 m before Monza's timing line (s 5472.5), not just short of it: at 180 km/h a
    // frame clamped to 0.25 s covers 12.5 m, so a car placed 12.5 m short crossed in its first
    // frame and claimed the lap before sending any snapshot from its new place; the room, still
    // holding the grid snapshot, rejected it (s_inconsistent, PR 66 CI). From 112.5 m the car
    // needs at least nine frames to reach the line, and its snapshots (30 Hz slots) from there
    // are inside the room's distance check (170 m) from the first one.
    for (const page of [host, guest]) {
      await page.evaluate(() => {
        window.__undercut!.teleport(5360, 0, 180);
        window.__undercut!.drive({ throttle: 0.3 });
      });
      await expect
        .poll(async () => (await state(page)).race?.claims.length, { timeout: 20_000 })
        .toBe(1);
      await expect.poll(async () => (await state(page)).race?.timing[0]?.status).toBe('accepted');
      if (page === host)
        expect([await programs(host), await programs(guest)]).toEqual(programsAtStart);
    }
    for (const page of [host, guest]) {
      await expect(page.getByTestId('online-results')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('online-results')).toContainText('1 lap ·');
      await expect(page.getByTestId('online-results')).not.toContainText('1 laps');
    }
    await host.screenshot({ path: info.outputPath('results-desktop.png') });
    await guest.screenshot({ path: info.outputPath('results-phone.png') });
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
