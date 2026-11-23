import { expect, test } from './base';
import { startQuickRace } from './helpers';

// Quick Race in three parts, each with an end state it controls: the start and the controls
// in a race (no finish needed), the provisional standings after the player's flag (the field
// held on the grid so the player is sure to take the flag first, with cars still racing), and
// the direct way to the result (the player never starts and retires, so the field finishes
// with no provisional stage).

test('Quick Race at Spa or Singapore: grid, lights, moving field; a reset parks off line; the pause menu restarts the race', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await page.goto('/?debug=1&quality=lite&world=lite');
  await page.waitForFunction(() => !!window.__undercut);
  // Through the menus at another circuit than Monza: Spa on a desktop, Singapore by day on a
  // phone (its own first sky is the night). Twenty cars on that circuit's grid, all in the trim
  // its racing line was built for.
  const at =
    info.project.name === 'phone'
      ? { circuit: 'singapore', timeOfDay: 'overcast-day', trim: 'high' }
      : { circuit: 'spa', timeOfDay: 'overcast-day', trim: 'medium' };
  await startQuickRace(page, { circuit: at.circuit, timeOfDay: at.timeOfDay });
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  const started = await page.evaluate(() => {
    const st = window.__undercut!.state();
    return { cars: st.cars, circuit: st.circuit, trim: st.trim, timeOfDay: st.timeOfDay };
  });
  expect(started).toEqual({
    cars: 20,
    circuit: at.circuit,
    trim: at.trim,
    timeOfDay: at.timeOfDay,
  });
  // The same race goes on: the grid, the five lights and lights out, the field moving off.
  expect(await page.evaluate(() => window.__undercut!.state().racePhase)).toMatch(/grid|lights/);
  // Every lights event as it comes (the state keeps only the last few race events).
  await page.evaluate(() => {
    const w = window as unknown as { lights: number[] };
    w.lights = [];
    const seen = new Set<number>();
    const watch = () => {
      const events = window.__undercut!.state().raceEvents as {
        type: string;
        t: number;
        count: number;
      }[];
      for (const e of events) {
        if (e.type !== 'lights' || seen.has(e.t)) continue;
        seen.add(e.t);
        w.lights.push(e.count);
      }
      requestAnimationFrame(watch);
    };
    watch();
    window.__undercut!.autopilot(true);
    window.__undercut!.setTimeScale(8);
  });
  await page.waitForFunction(() => window.__undercut!.state().racePhase === 'green', null, {
    timeout: 60_000,
  });
  expect(await page.evaluate(() => (window as unknown as { lights: number[] }).lights)).toEqual([
    1, 2, 3, 4, 5, 0,
  ]);
  await expect(page.getByTestId('race-status')).toContainText('/ 20');
  await page.waitForFunction(() => Number(window.__undercut!.telemetry().speed) > 10);
  // Tyres and fuel on the HUD: the panel's four treads by temperature band and the fuel on board
  // on a desktop, the compact strip on a phone.
  const shown = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="hud-tyres"]');
    const strip = document.querySelector<HTMLElement>('[data-testid="hud-mini-tyres"]');
    const visible = (e: HTMLElement | null) => !!e && getComputedStyle(e).display !== 'none';
    const on = visible(panel) ? panel! : strip!;
    return {
      either: visible(panel) !== visible(strip),
      bands: Array.from(on.querySelectorAll<HTMLElement>('[data-band]')).map((e) => e.dataset.band),
      text: on.textContent ?? '',
    };
  });
  expect(shown.either).toBe(true);
  expect(shown.bands).toHaveLength(4);
  for (const b of shown.bands) expect(['cold', 'ok', 'warm', 'hot']).toContain(b);
  expect(shown.text).toMatch(/\d+\.\d kg/);
  // A reset in a race parks the car stopped at the edge, off the racing line, not on it in
  // front of the field.
  const parked = await page.evaluate(() => {
    const u = window.__undercut!;
    u.resetToTrack();
    return { d: Number(u.state().d), speed: Number(u.telemetry().speed) };
  });
  expect(Math.abs(parked.d)).toBeGreaterThan(3);
  expect(Math.abs(parked.speed)).toBeLessThan(1);
  // The pause menu restarts the race, not a lap.
  await page.evaluate(() => window.__undercut!.pause());
  await expect(page.locator('.pause__action[data-action="restart"]')).toHaveText('Restart race');
  await page.evaluate(() => window.__undercut!.quit());
});

test('Quick Race: provisional standings after the player takes the flag, then the result', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/?debug=1&quality=lite&world=lite');
  await page.waitForFunction(() => !!window.__undercut);
  // One lap from pole, the field held on the grid for 55 s after lights out (under the 60 s
  // after which a car standing still is retired). The player's car on its racing driver, which
  // drives in the sim step whatever the frame rate, takes the flag some 45 s of race time
  // before the first of the others: several seconds to look at eight times real time.
  await page.evaluate(() =>
    window.__undercut!.startQuickRace(1, { gridPosition: 1, fieldStartDelay: 55 }),
  );
  await page.evaluate(() => {
    window.__undercut!.raceDriver(true);
    window.__undercut!.setTimeScale(8);
  });
  // The standings take the screen then: provisional, Skip to results inside the viewport (a
  // landscape phone is 390 px tall), the driving cluster gone and the first-lap coach finished
  // (it counted the race lap). Read in one call, the race held there as soon as it is seen.
  const layout = await page.waitForFunction(
    () => {
      const st = window.__undercut!.state();
      const rows = st.standings as { status: string }[];
      const skip = document.querySelector<HTMLElement>('[data-testid="skip-results"]');
      if (st.provisional !== true || !skip || skip.hidden) return null;
      // Hold the moment: the field would come home at eight times real time.
      window.__undercut!.setTimeScale(0.25);
      const cluster = document.querySelector<HTMLElement>('.hud-cluster');
      const coach = document.querySelector<HTMLElement>('[data-testid="onboarding"]');
      return {
        running: rows.filter((r) => r.status === 'running').length,
        skipBottom: skip.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
        clusterShown: !!cluster && getComputedStyle(cluster).display !== 'none',
        coachFinished: !coach || coach.hidden,
      };
    },
    null,
    { timeout: 60_000 },
  );
  const seen = (await layout.jsonValue())!;
  expect(seen.running).toBe(19);
  // (The readout is rebuilt a few times a second: read once it has caught up.)
  await expect(page.getByTestId('race-status')).toContainText('provisional');
  expect(seen.skipBottom).toBeLessThanOrEqual(seen.viewport);
  expect(seen.clusterShown).toBe(false);
  expect(seen.coachFinished).toBe(true);
  // Skip to results runs the field home; the classification follows.
  await page.getByTestId('skip-results').click();
  await page.waitForFunction(() => !!window.__undercut!.state().raceResult, null, {
    timeout: 60_000,
  });
  await expect(page.getByTestId('race-status')).toContainText('Race result');
  await page.evaluate(() => window.__undercut!.quit());
});

test('Quick Race: straight to the result when the player does not finish', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?debug=1&quality=lite&world=lite');
  await page.waitForFunction(() => !!window.__undercut);
  // From the back of the grid, the player never moves: retired as stuck after a minute, while
  // the field finishes the lap. The result comes straight away, with no provisional stage.
  await page.evaluate(() => window.__undercut!.startQuickRace(1, { gridPosition: 20 }));
  await page.evaluate(() => {
    const w = window as unknown as { sawProvisional: boolean };
    w.sawProvisional = false;
    const watch = () => {
      if (window.__undercut?.state().provisional === true) w.sawProvisional = true;
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    window.__undercut!.setTimeScale(8);
  });
  await page.waitForFunction(() => !!window.__undercut!.state().raceResult, null, {
    timeout: 60_000,
  });
  const end = await page.evaluate(() => {
    const st = window.__undercut!.state();
    const result = st.raceResult as { entries: { car: number; status: string }[] };
    const cluster = document.querySelector<HTMLElement>('.hud-cluster');
    const skip = document.querySelector<HTMLElement>('[data-testid="skip-results"]');
    return {
      sawProvisional: (window as unknown as { sawProvisional: boolean }).sawProvisional,
      player: result.entries.find((e) => e.car === 0)?.status,
      finished: result.entries.filter((e) => e.status === 'finished').length,
      clusterShown: !!cluster && getComputedStyle(cluster).display !== 'none',
      skipShown: !!skip && !skip.hidden,
    };
  });
  expect(end.sawProvisional).toBe(false);
  expect(end.player).toBe('dnf');
  expect(end.finished).toBe(19);
  // A retirement is a final result too: the standings, not the driving cluster.
  expect(end.clusterShown).toBe(false);
  expect(end.skipShown).toBe(false);
  await expect(page.getByTestId('race-status')).toContainText('Race result');
  await page.evaluate(() => window.__undercut!.quit());
});
