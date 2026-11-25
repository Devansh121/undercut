import { expect, test } from './base';
import { DESKTOP, PHONES, fitEverywhere } from './fit-sweep';
import { watchProblems } from './helpers';

test('race display: start lights, 20-car timing tower, yellow sector on minimap, pit & penalty messages, and classification results', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const problems = watchProblems(page);
  const isPhone = info.project.name === 'phone';
  const sizes = isPhone ? PHONES : DESKTOP;

  await page.goto('/?debug=1&quality=lite&world=lite');
  await page.waitForFunction(() => !!window.__undercut);

  // Start a 1-lap Quick Race from P10 so the timing tower has cars ahead and behind the player.
  await page.evaluate(() => {
    const w = window as unknown as {
      lightsObserved: { lit: number; mask: number }[];
    };
    w.lightsObserved = [];
    let lastLit = -1;
    const watch = () => {
      const u = window.__undercut;
      const el = document.querySelector<HTMLElement>('[data-testid="start-lights"]');
      if (u && el && !el.hidden) {
        const lit = Number(el.dataset.lights ?? -1);
        if (lit >= 0 && lit !== lastLit) {
          lastLit = lit;
          w.lightsObserved.push({ lit, mask: Number(u.state().startLightsMask) });
        }
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    return window.__undercut!.startQuickRace(1, { gridPosition: 10 });
  });

  // Run through the lights ramp slowly enough to observe lit pods synced with the 3D gantry.
  await page.evaluate(() => {
    window.__undercut!.setTimeScale(2);
  });

  const lightsEl = page.getByTestId('start-lights');
  await expect(lightsEl).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLElement>('[data-testid="start-lights"]');
      return !!el && !el.hidden && Number(el.dataset.lights) >= 3;
    },
    null,
    { timeout: 30_000 },
  );

  // Verify 3D start gantry bitmask matches lit pods on screen.
  const midLights = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="start-lights"]')!;
    const lit = Number(el.dataset.lights);
    const litPods = el.querySelectorAll('.hud-lights__pod.is-lit').length;
    const mask = Number(window.__undercut!.state().startLightsMask);
    return { lit, litPods, mask };
  });
  expect(midLights.litPods).toBe(midLights.lit);
  expect(midLights.mask).toBe((1 << midLights.lit) - 1);

  // Creep 2 m past the grid box while lights are still red -> triggers real jump-start penalty.
  await page.evaluate(() => {
    const u = window.__undercut!;
    const st = u.state();
    u.teleport(Number(st.s) + 2, Number(st.d), 0);
  });

  // Jump-start indicator and race-control penalty message both appear before lights out.
  await expect(page.getByTestId('jump-start')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('jump-start')).toContainText('+5 s');
  await expect(page.getByTestId('race-messages')).toBeVisible();
  await expect(page.getByTestId('race-messages')).toContainText(/Jump start/i);

  // Speed through to green flag: lights go out on both UI and 3D gantry.
  await page.evaluate(() => window.__undercut!.setTimeScale(6));
  await page.waitForFunction(() => window.__undercut!.state().racePhase === 'green', null, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__undercut!.setTimeScale(0));
  expect(await page.evaluate(() => Number(window.__undercut!.state().startLightsMask))).toBe(0);

  const observed = await page.evaluate(
    () => (window as unknown as { lightsObserved: { lit: number; mask: number }[] }).lightsObserved,
  );
  expect(observed.length).toBeGreaterThanOrEqual(2);
  for (const step of observed) {
    expect(step.mask).toBe(step.lit > 0 ? (1 << step.lit) - 1 : 0);
  }

  // Timing tower: full 20-car tower with gap/interval toggle on desktop, 4-row window on phone.
  const tower = page.getByTestId('tower');
  await expect(tower).toBeVisible();
  const towerRows = tower.locator('.hud-tower__row');
  if (isPhone) {
    await expect(towerRows).toHaveCount(4);
    await expect(towerRows.first().locator('.hud-tower__pos')).toHaveText('1');
    await expect(tower.locator('.hud-tower__row.is-player')).toHaveCount(1);
  } else {
    await expect(towerRows).toHaveCount(20);
    await expect(tower.locator('.hud-tower__row.is-player')).toHaveCount(1);
    await expect(tower.locator('.hud-tower__row .hud-tower__tyre')).toHaveCount(20);
    await expect(tower.locator('.hud-tower__row .hud-tower__age').first()).toBeVisible();
    await expect(tower.locator('.hud-tower__row .hud-tower__pits').first()).toBeVisible();

    const gapToggle = page.getByTestId('tower-gap-toggle');
    await expect(gapToggle).toBeVisible();
    await expect(gapToggle).toHaveAttribute('data-mode', 'gap');
    await gapToggle.click();
    await expect(gapToggle).toHaveAttribute('data-mode', 'interval');
    await expect(gapToggle).toHaveText('Int');
    await gapToggle.click();
    await expect(gapToggle).toHaveAttribute('data-mode', 'gap');
    await expect(gapToggle).toHaveText('Gap');
  }

  // Stop on track in Sector 2 so a real local yellow flag triggers right after START_GRACE (4 s),
  // highlighting the banner, timing tower status, and minimap sector overlay.
  await page.evaluate(() => {
    window.__undercut!.raceDriver(false);
    window.__undercut!.drive({ brake: 1 });
    window.__undercut!.teleport(2400, 0, 0);
    window.__undercut!.setTimeScale(8);
  });

  const raceFlag = page.getByTestId('race-flag');
  await expect(raceFlag).toBeVisible({ timeout: 30_000 });
  await expect(raceFlag).toHaveAttribute('data-flag', 'yellow');
  await expect(raceFlag).toContainText(/Yellow flag/i);
  await expect(page.getByTestId('tower-status')).toHaveAttribute('data-flag', 'yellow');

  const yellowSegments = page.locator('[data-testid="map-yellow-sectors"] [data-yellow="on"]');
  expect(await yellowSegments.count()).toBeGreaterThanOrEqual(1);

  // Call a pit stop and verify the pit message enters the race-control message queue.
  await page.evaluate(() => {
    window.__undercut!.setTimeScale(1);
    window.__undercut!.drive(null);
  });
  if (isPhone) {
    await page.locator('.ut-touch__btn--boxThisLap').tap();
  } else {
    await page.keyboard.press('i');
  }
  await expect(page.getByTestId('race-messages')).toBeVisible();
  await expect(page.getByTestId('race-messages')).toContainText(/Box/i);
  await page.evaluate(() => window.__undercut!.setTimeScale(0));

  // Accessibility hooks (colour-blind palette, reduced motion, HUD scale) and full fit sweep
  // while the race tower, yellow flag banner, minimap yellow sector, and message queue are live.
  await page.evaluate(() => {
    const r = document.documentElement;
    r.dataset.cb = 'on';
    r.dataset.motion = 'reduce';
    r.style.setProperty('--hud-scale', '1.1');
  });
  const a11yOk = await page.evaluate(() => {
    const seg = document.querySelector<SVGElement>(
      '[data-testid="map-yellow-sectors"] [data-yellow="on"]',
    );
    return {
      cb: document.documentElement.dataset.cb,
      motion: document.documentElement.dataset.motion,
      animName: seg ? getComputedStyle(seg).animationName : '',
    };
  });
  expect(a11yOk.cb).toBe('on');
  expect(a11yOk.motion).toBe('reduce');
  expect(a11yOk.animName).toBe('none');
  await page.evaluate(() => {
    const r = document.documentElement;
    delete r.dataset.cb;
    delete r.dataset.motion;
    r.style.removeProperty('--hud-scale');
  });

  expect(await fitEverywhere(page, { label: 'live race HUD (yellow + messages)', sizes })).toEqual(
    [],
  );

  // Cancel the pit call and let the racing driver finish the 1-lap race to inspect final results.
  await page.evaluate(() => {
    window.__undercut!.setTimeScale(1);
  });
  if (isPhone) {
    await page.locator('.ut-touch__btn--boxThisLap').tap();
  } else {
    await page.keyboard.press('i');
  }
  await page.evaluate(() => {
    window.__undercut!.raceDriver(true);
    window.__undercut!.setTimeScale(8);
  });

  // Either provisional appears (click Skip to results atomically) or final raceResult arrives directly.
  await page.waitForFunction(
    () => {
      const st = window.__undercut!.state();
      if (st.provisional === true) {
        const skip = document.querySelector<HTMLElement>('[data-testid="skip-results"]');
        if (skip && !skip.hidden) skip.click();
      }
      return !!st.raceResult;
    },
    null,
    { timeout: 120_000 },
  );

  // Shared classification table: 20 rows, team colour bars, fastest-lap highlight, penalty, actions.
  const status = page.locator('[data-testid="race-status"][data-table]');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Race result');
  await expect(status.locator('tbody tr')).toHaveCount(20);
  await expect(status.locator('.classification__bar')).toHaveCount(20);
  await expect(status.locator('td.is-fastest')).toHaveCount(1);
  await expect(status.locator('tr.is-player')).toContainText(/\+5 s|5 s served/);
  if (!isPhone) {
    await expect(status.locator('th')).toHaveText([
      'Pos',
      'Driver',
      'Team',
      'Time',
      'Best lap',
      'Pits',
      'Tyres',
      'Pen',
      'Pts',
    ]);
  }

  // Lap timer is stopped behind final results and pit panel is hidden.
  await expect(page.getByTestId('pit-panel')).toBeHidden();
  const lapBefore = await page.getByTestId('lap-time').textContent();
  await page.waitForTimeout(250);
  expect(await page.getByTestId('lap-time').textContent()).toBe(lapBefore);

  // Results action bar fits everywhere and Quit to menu returns to launch.
  await expect(page.getByTestId('results-restart')).toBeVisible();
  await expect(page.getByTestId('results-menu')).toBeVisible();
  expect(await fitEverywhere(page, { label: 'final race classification', sizes })).toEqual([]);

  await page.getByTestId('results-menu').click();
  await page.waitForFunction(() => window.__undercut!.state().screen === 'launch', null, {
    timeout: 15_000,
  });
  expect(problems).toEqual([]);
});
