import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { SurfaceKind } from '@undercut/sim';
import { Track, createGround } from '@undercut/track';
import raw from '@undercut/track/data/monza.json' with { type: 'json' };

/**
 * The drive screen, driven through the debug API (`?debug=1`) instead of key timing. These
 * tests share one session per worker (see fixtures.ts) on the `lite` render preset.
 */

const track = Track.fromJSON(raw);

/** A patch of gravel at least 3 m across near the first chicane, found from the track data. */
function findGravel(): { s: number; d: number } {
  const g = createGround();
  const gravel = (s: number, d: number): boolean =>
    track.ground(s, d, g).kind === SurfaceKind.Gravel;
  for (let s = 560; s < 1200; s += 4) {
    for (const side of [1, -1]) {
      for (let k = 2; k < 60; k += 0.5) {
        const d = side * (track.halfWidthAt(s, side > 0 ? 0 : 1) + k);
        if ([-3, 0, 3].every((ds) => [-1.5, 0, 1.5].every((dd) => gravel(s + ds, d + dd))))
          return { s, d };
      }
    }
  }
  throw new Error('no gravel near the first chicane');
}

type State = Record<string, unknown> & {
  s: number;
  d: number;
  tick: number;
  time: number;
  lap: number;
  running: boolean;
  sector: number;
  sectors: number[];
  camera: string;
  surface: number;
  paused: boolean;
};

const state = (page: Page): Promise<State> =>
  page.evaluate(() => window.__undercut?.state() as State);
interface Telemetry {
  speed: number;
  gear: number;
  yaw: number;
}
const telemetry = (page: Page): Promise<Telemetry> =>
  page.evaluate(() => window.__undercut?.telemetry() as unknown as Telemetry);

test.describe('drive', () => {
  test.describe.configure({ timeout: 60_000 });

  test('accelerates, steers and brakes, with speed and gear on the HUD', async ({
    drive: { page, problems },
  }) => {
    const hud0 = await page.evaluate(
      () => window.__undercut?.capture().hud as Record<string, string>,
    );
    const t0 = await telemetry(page);

    await page.evaluate(() => {
      window.__undercut?.teleport(300, 0, 0);
      window.__undercut?.drive({ throttle: 1, steer: 0 });
      window.__undercut?.setTimeScale(2);
    });
    await page.waitForFunction(() => (window.__undercut?.telemetry().speed as number) > 40);
    const fast = await telemetry(page);
    expect(fast.gear).toBeGreaterThan(1);
    await expect(page.locator('[data-testid=speed]')).not.toHaveText(hud0.speed ?? '');
    const hudSpeed = Number(await page.locator('[data-testid=speed]').textContent());
    expect(hudSpeed).toBeGreaterThan(100);

    // Steering left turns the car left (yaw grows). The yaw is read once 0.2 s of sim time has
    // passed, at real time: about a second later the car meets the left wall of the straight and
    // slides along it parallel to the straight, which hides the turn from a late reading (a slow
    // runner's polls were that late). A frame advances at most 0.25 s, so this reads at 0.2 to
    // 0.45 s.
    const turned = await page.evaluate(async () => {
      const u = window.__undercut!;
      u.setTimeScale(1);
      const yaw0 = u.telemetry().yaw as number;
      const t0 = u.state().time as number;
      u.drive({ throttle: 0.3, steer: 0.4 });
      while ((u.state().time as number) < t0 + 0.2) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const yaw = u.telemetry().yaw as number;
      u.setTimeScale(2);
      return Math.atan2(Math.sin(yaw - yaw0), Math.cos(yaw - yaw0));
    });
    expect(turned).toBeGreaterThan(0.02);

    await page.evaluate(() => window.__undercut?.drive({ throttle: 0, brake: 1, steer: 0 }));
    await page.waitForFunction(() => (window.__undercut?.telemetry().speed as number) < 5, null, {
      timeout: 15_000,
    });
    expect(t0.speed).toBeGreaterThan(0);
    await expect(page.locator('[data-testid=gear]')).toHaveText(/^[1-3N]$/);
    expect(problems).toEqual([]);
  });

  test('times the start line and a sector line', async ({ drive: { page, problems } }) => {
    await page.evaluate(() => {
      const u = window.__undercut;
      // 72 m before Monza's timing line (the control line, s = 5472.5).
      u?.teleport(5400, 0, 250);
      u?.autopilot(true);
      u?.setTimeScale(8);
    });
    await page.waitForFunction(() => window.__undercut?.state().running === true, null, {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid=lap-time]')).not.toHaveText('0:00.000');
    await page.waitForFunction(
      () => (window.__undercut?.state().sectors as number[]).length >= 1,
      null,
      {
        timeout: 60_000,
      },
    );
    const st = await state(page);
    expect(st.lap).toBe(1);
    expect(st.sectors[0]).toBeGreaterThan(15);
    expect(st.sectors[0]).toBeLessThan(40);
    // The HUD shows the first sector in a timing colour with a millisecond time.
    const s1 = page.locator('[data-testid=sector-1]');
    await expect(s1).toHaveAttribute('data-state', /overall|personal|slower/);
    await expect(s1).toContainText(/\d+\.\d{3}/);
    expect(problems).toEqual([]);
  });

  test('pause freezes the clock and the car; resume continues', async ({
    drive: { page, problems },
  }) => {
    await page.evaluate(() => window.__undercut?.drive({ throttle: 1 }));
    await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(30);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid=pause-menu]')).toBeVisible();
    const a = await state(page);
    expect(a.paused).toBe(true);
    await page.waitForTimeout(800);
    const b = await state(page);
    expect(b.tick).toBe(a.tick);
    expect(b.s).toBe(a.s);
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.locator('[data-testid=pause-menu]')).toBeHidden();
    await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(b.tick);
    expect(problems).toEqual([]);
  });

  test('resets to the track from the gravel', async ({ drive: { page, problems } }) => {
    const { s, d } = findGravel();
    await page.evaluate(([s, d]) => window.__undercut?.teleport(s, d, 0), [s, d] as const);
    await expect.poll(async () => (await state(page)).surface).toBe(SurfaceKind.Gravel);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Reset to track' }).click();
    await expect(page.locator('[data-testid=pause-menu]')).toBeHidden();
    const after = await state(page);
    expect(Math.abs(after.d)).toBeLessThan(0.3);
    expect(after.surface).toBe(SurfaceKind.Asphalt);
    expect(Math.abs((await telemetry(page)).speed)).toBeLessThan(1);
    expect(problems).toEqual([]);
  });

  test('stays sane off the track: stops at the barrier with a bounded pose', async ({
    drive: { page, problems },
  }, testInfo) => {
    // The owner's run: last grid slot, 30 m/s, wheel straight, full throttle. The track bends
    // away and the car leaves it on the run to the first chicane.
    const slot = track.gridSlots[track.gridSlots.length - 1]!;
    await page.evaluate(
      ([s, d]) => {
        window.__undercut?.teleport(s, d, 108);
        // Every pedal explicitly: drive() merges into the held input, and the first test leaves
        // the brake on. With it held (ABS trimming it to about 0.3) the car crawled at 30 m/s
        // into the turn 1 run-off instead of making the owner's run, and parked where reverse
        // could stall.
        window.__undercut?.drive({ throttle: 1, brake: 0, steer: 0 });
        window.__undercut?.setTimeScale(8);
      },
      [slot.s, slot.d] as const,
    );
    interface Pose {
      s: number;
      d: number;
      time: number;
      safetyResets: number;
      wallHits: number;
      pitch: number;
      roll: number;
      rideHeightFront: number;
      rideHeightRear: number;
      speed: number;
    }
    const pose = (): Promise<Pose> =>
      page.evaluate(() => {
        const st = window.__undercut!.state();
        const t = window.__undercut!.telemetry();
        return { ...st, ...t } as unknown as Pose;
      });
    const seen: Pose[] = [];
    const start = await pose();
    // Up to 40 s of sim time, as in the owner's run, or 5 s past the first barrier strike.
    let struckAt = Infinity;
    for (;;) {
      const p = await pose();
      seen.push(p);
      if (p.wallHits > start.wallHits && struckAt === Infinity) struckAt = p.time;
      if (p.time - start.time > 40 || p.time > struckAt + 5) break;
      await page.waitForTimeout(100);
    }
    expect(struckAt, 'the car reached the barrier').toBeLessThan(Infinity);
    // The game checks the sim's invariants every tick; the safety net never had to act.
    expect(seen.at(-1)!.safetyResets).toBe(start.safetyResets);
    for (const p of seen) {
      expect(Math.abs(p.pitch)).toBeLessThan(0.2);
      expect(Math.abs(p.roll)).toBeLessThan(0.2);
      expect(Math.max(p.rideHeightFront, p.rideHeightRear)).toBeLessThan(0.65);
      // The car's centre is always inside the barrier line on its side.
      const side = p.d >= 0 ? 0 : 1;
      expect(Math.abs(p.d)).toBeLessThan(track.barrierAt(p.s, side));
    }
    // Lift off and brake: the car comes to rest against the barrier.
    await page.evaluate(() => window.__undercut?.drive({ throttle: 0, brake: 1, steer: 0 }));
    await expect
      .poll(async () => Math.abs((await pose()).speed), { timeout: 20_000 })
      .toBeLessThan(0.5);
    await page.evaluate(() => {
      window.__undercut?.setTimeScale(1);
      window.__undercut?.camera('chase-far');
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath('car-at-barrier.png') });
    const rest = await pose();
    expect(rest.safetyResets).toBe(start.safetyResets);
    // Parked against the barrier with the keyboard's default assists (automatic gears): Q twice
    // selects reverse through neutral, and the car backs away.
    const gear = async (): Promise<number> =>
      page.evaluate(() => window.__undercut!.telemetry().gear as number);
    await page.evaluate(() => window.__undercut?.drive({ brake: 0, throttle: 0, gearShift: -1 }));
    await expect.poll(gear).toBe(0);
    await page.evaluate(() => window.__undercut?.drive({ gearShift: -1 }));
    await expect.poll(gear).toBe(-1);
    await page.evaluate(() => window.__undercut?.drive({ throttle: 0.5 }));
    await expect.poll(async () => (await pose()).speed, { timeout: 10_000 }).toBeLessThan(-1);
    await page.evaluate(() => window.__undercut?.drive(null));
    expect(problems).toEqual([]);
  });

  test('switches cameras live on the camera key and from the pause menu', async ({
    drive: { page, problems },
  }) => {
    expect((await state(page)).camera).toBe('chase-near');
    await page.keyboard.press('KeyC');
    await expect.poll(async () => (await state(page)).camera).toBe('chase-far');
    await expect(page.locator('[data-testid=hud-message]')).toContainText('Far chase');
    await page.keyboard.press('KeyC');
    await expect.poll(async () => (await state(page)).camera).toBe('tcam');
    await page.keyboard.press('Escape');
    await page.locator('[data-setting=camera] button', { hasText: 'Cockpit' }).click();
    expect((await state(page)).camera).toBe('cockpit');
    await page.getByRole('button', { name: 'Resume' }).click();
    expect(problems).toEqual([]);
  });

  test('the steering-wheel display shows the gear, speed and revs in the cockpit', async ({
    drive: { page },
  }) => {
    await page.evaluate(() => {
      window.__undercut?.camera('cockpit');
      window.__undercut?.teleport(300, 0, 200);
      window.__undercut?.drive({ throttle: 1, steer: 0 });
    });
    await expect
      .poll(async () => {
        const [dash, t] = await page.evaluate(() => [
          window.__undercut?.dashboard(),
          window.__undercut?.telemetry(),
        ]);
        const d = dash as { gear: string; speed: string; revs: number } | null;
        const tel = t as { gear: number; speed: number };
        return (
          d !== null &&
          d.gear === String(tel.gear) &&
          Math.abs(Number(d.speed) - tel.speed * 3.6) < 15
        );
      })
      .toBe(true);
  });

  test('draws a non-empty 3D view behind the HUD', async ({ drive: { page } }) => {
    // Hide the HUD and touch overlay for this capture only: the page is shared with other tests.
    await page.waitForFunction(() => (window.__undercut?.state().tick as number) > 10);
    const png = await page
      .locator('#view')
      .screenshot({ style: '#app, .ut-touch { visibility: hidden; }' });
    const stats = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      const colours = new Set<number>();
      let sum = 0;
      let sumSq = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        colours.add((r << 16) | (g << 8) | b);
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += luma;
        sumSq += luma * luma;
      }
      const mean = sum / n;
      return { colours: colours.size, lumaStdDev: Math.sqrt(sumSq / n - mean * mean) };
    }, png.toString('base64'));
    expect(stats.colours).toBeGreaterThan(500);
    expect(stats.lumaStdDev).toBeGreaterThan(10);
  });

  test('lays out the HUD inside the viewport with nothing overlapping', async ({
    drive: { page },
  }) => {
    // Measure the steady HUD: the camera test above leaves a 1.4 s "Far chase" notice, which on
    // a slow runner can still be showing here (the message slot's layout is a separate check).
    await expect(page.locator('[data-testid=hud-message]')).toBeHidden({ timeout: 10_000 });
    const report = await page.evaluate(() => {
      const problems: string[] = [];
      const { innerWidth: w, innerHeight: h } = window;
      const root = document.documentElement;
      if (root.scrollWidth > w) problems.push(`page is ${root.scrollWidth}px wide`);
      if (root.scrollHeight > h) problems.push(`page is ${root.scrollHeight}px tall`);
      const boxes: { name: string; r: DOMRect }[] = [];
      const visible = (el: Element): boolean => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      for (const el of document.querySelectorAll('.hud > *, .ut-touch > *')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        const name = el.className.toString().split(' ')[0] ?? el.tagName;
        if (r.left < 0 || r.top < 0 || r.right > w + 0.5 || r.bottom > h + 0.5)
          problems.push(`${name} leaves the viewport`);
        boxes.push({ name, r });
      }
      for (const el of document.querySelectorAll('.hud *')) {
        if (!(el instanceof HTMLElement) || !visible(el)) continue;
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible')
          problems.push(`${el.className} clips its content`);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]?.r as DOMRect;
          const b = boxes[j]?.r as DOMRect;
          const overlap =
            a.left < b.right - 1 &&
            b.left < a.right - 1 &&
            a.top < b.bottom - 1 &&
            b.top < a.bottom - 1;
          if (overlap) problems.push(`${boxes[i]?.name} overlaps ${boxes[j]?.name}`);
        }
      }
      return problems;
    });
    expect(report).toEqual([]);
  });

  test('keeps the whole car visible above the driver cluster in both chase cameras', async ({
    drive: { page },
  }) => {
    for (const camera of ['chase-near', 'chase-far']) {
      for (const at of [{ restart: true }, { s: 300, kmh: 280 }]) {
        await page.evaluate(
          ([camera, at]) => {
            const u = window.__undercut;
            u?.setTimeScale(1);
            u?.camera(camera as string);
            const p = at as { restart?: boolean; s?: number; kmh?: number };
            if (p.restart) u?.restartLap();
            else u?.teleport(p.s ?? 0, 0, p.kmh ?? 0);
            u?.drive({ throttle: 0.6, steer: 0 });
          },
          [camera, at] as const,
        );
        // Let the car run briefly, then freeze the sim: the cameras and lift ease on clamped real
        // time (dt <= 0.25 s, slowest tau = 0.25 s), so 1.5 s of clamped frame time (>= 8 frames)
        // converges them to >99.7 % without waiting for 30 slow software-WebGL frames.
        await page.waitForTimeout(500);
        await page.evaluate(() => {
          window.__undercut?.setTimeScale(0);
          window.__undercut?.resetFrameTimes();
        });
        await page.waitForFunction(
          () => {
            const times = window.__undercut?.frameTimes() ?? [];
            let clamped = 0;
            for (const ms of times) clamped += Math.min(250, ms);
            return times.length >= 8 && clamped >= 1500;
          },
          null,
          {
            timeout: 30_000,
          },
        );
        const r = await page.evaluate(() => {
          const car = window.__undercut?.carScreenRect() as {
            left: number;
            top: number;
            right: number;
            bottom: number;
          };
          const c = document.querySelector('.hud-drive')?.getBoundingClientRect();
          return {
            car,
            cluster: c && { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
          };
        });
        if (!r.cluster) throw new Error('no cluster');
        const overlap =
          r.car.left < r.cluster.right &&
          r.cluster.left < r.car.right &&
          r.car.top < r.cluster.bottom &&
          r.cluster.top < r.car.bottom;
        expect(
          overlap,
          `${camera} ${JSON.stringify(at)}: car ${JSON.stringify(r.car)} cluster ${JSON.stringify(r.cluster)}`,
        ).toBe(false);
        // And the car is on screen, not lifted out of the top.
        expect(r.car.top).toBeGreaterThan(0);
      }
    }
  });

  test('keeps quiet about storage when it works', async ({ drive: { page } }) => {
    await page.keyboard.press('Escape');
    // Wait for the menu (and its note) first: absence of text in a closed menu proves nothing,
    // and a key still in flight would pause whatever runs next on this shared page.
    const menu = page.locator('[data-testid=pause-menu]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.pause__sub')).toContainText('assists');
    await expect(menu).not.toContainText('Records last');
  });

  test('drives the car with the touch overlay on a phone', async ({
    drive: { page, problems },
  }, info) => {
    test.skip(info.project.name !== 'phone', 'touch runs on the phone project');
    await expect(page.locator('[data-testid=touch-overlay]')).toBeVisible();
    await page.evaluate(() => window.__undercut?.teleport(300, 0, 0));
    const pedal = await page.locator('[data-control=throttle]').boundingBox();
    if (!pedal) throw new Error('no throttle pedal');
    const cdp = await page.context().newCDPSession(page);
    const point = { x: pedal.x + pedal.width / 2, y: pedal.y + pedal.height * 0.15, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForFunction(() => (window.__undercut?.telemetry().speed as number) > 8, null, {
      timeout: 15_000,
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point] });
    expect((await state(page)).device).toBe('touch');
    expect(problems).toEqual([]);
  });

  test('shows every assist with a description in the pause menu and toggles stability', async ({
    drive: { page, problems },
  }) => {
    await page.keyboard.press('Escape');
    const menu = page.locator('[data-testid=pause-menu]');
    await expect(menu).toBeVisible();
    for (const id of ['tc', 'abs', 'stability', 'braking', 'gears', 'steering', 'line']) {
      const row = menu.locator(`[data-setting=${id}]`);
      await expect(row).toBeVisible();
      await expect(row.locator('.pause__help')).not.toBeEmpty();
    }
    const stab = menu.locator('[data-setting=stability]');
    await stab.getByRole('radio', { name: 'Off' }).click();
    expect(((await state(page)).assists as { stability?: number }).stability).toBe(0);
    await stab.getByRole('radio', { name: 'On' }).click();
    expect(((await state(page)).assists as { stability?: number }).stability).toBe(1);
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(menu).toBeHidden();
    expect(problems).toEqual([]);
  });

  test('draws the driving line, toggles from pause and shifts braking with speed', async ({
    drive: { page, problems },
  }, info) => {
    const waitFrames = async (n = 2): Promise<void> => {
      await page.evaluate(
        (count) =>
          new Promise<void>((resolve) => {
            let left = count;
            const step = (): void => {
              if (--left <= 0) resolve();
              else requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          }),
        n,
      );
    };
    const countWarmPixels = async (): Promise<number> => {
      const box = await page.locator('#view').boundingBox();
      if (!box) throw new Error('no #view bounding box');
      const clip = {
        x: box.x + Math.floor(box.width * 0.25),
        y: box.y + Math.floor(box.height * 0.42),
        width: Math.max(1, Math.ceil(box.width * 0.5)),
        height: Math.max(1, Math.ceil(box.height * 0.43)),
      };
      const png = await page.screenshot({
        clip,
        style: '#app, .ut-touch { visibility: hidden; }',
      });
      return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = new OffscreenCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, img.width, img.height);
        let warm = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;
          if (r > 135 && r > g + 45 && r > b + 45) warm++;
        }
        return warm;
      }, png.toString('base64'));
    };

    // Default mode matches the device preset: braking for keyboard and touch alike (the brief).
    // On the phone a pedal tap first makes touch the active device.
    if (info.project.name === 'phone') {
      const pedal = await page.locator('[data-control=throttle]').boundingBox();
      if (!pedal) throw new Error('no throttle pedal');
      const cdp = await page.context().newCDPSession(page);
      const pt = { x: pedal.x + pedal.width / 2, y: pedal.y + pedal.height * 0.5, id: 1 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
      await waitFrames(2);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pt] });
    }
    await waitFrames();
    const initial = await page.evaluate(() => window.__undercut?.drivingLine());
    expect((await state(page)).device).toBe(info.project.name === 'phone' ? 'touch' : 'keyboard');
    expect(initial?.mode).toBe('braking');

    // Pause menu switches between Off, Full and Braking.
    await page.keyboard.press('Escape');
    const menu = page.locator('[data-testid=pause-menu]');
    await expect(menu).toBeVisible();
    const lineRow = menu.locator('[data-setting=line]');
    await lineRow.getByRole('radio', { name: 'Off' }).click();
    await waitFrames(1);
    expect((await page.evaluate(() => window.__undercut?.drivingLine()))?.mode).toBe('off');
    expect((await page.evaluate(() => window.__undercut?.drivingLine()))?.visible).toBe(false);
    await lineRow.getByRole('radio', { name: 'Full' }).click();
    await waitFrames(1);
    expect((await page.evaluate(() => window.__undercut?.drivingLine()))?.mode).toBe('full');
    await lineRow.getByRole('radio', { name: 'Braking' }).click();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(menu).toBeHidden();

    // Approaching Monza's first chicane: arriving faster moves the braking zone closer and widens it.
    await page.evaluate(() => {
      const u = window.__undercut;
      u?.setTimeScale(0);
      u?.camera('chase-near');
      u?.teleport(420, 0, 120);
    });
    await waitFrames();
    const slow = await page.evaluate(() => window.__undercut?.drivingLine());

    await page.evaluate(() => {
      window.__undercut?.teleport(420, 0, 310);
    });
    await waitFrames();
    const fast = await page.evaluate(() => window.__undercut?.drivingLine());

    expect(fast?.visible).toBe(true);
    expect(fast?.brakeCount ?? 0).toBeGreaterThan(slow?.brakeCount ?? 0);
    expect(fast?.firstBrakeDistance).not.toBeNull();
    if (slow?.firstBrakeDistance !== null && slow?.firstBrakeDistance !== undefined) {
      expect(fast?.firstBrakeDistance as number).toBeLessThan(slow.firstBrakeDistance);
    }

    // Rendered pixels on the WebGL canvas actually show the red braking ribbon and clear when off.
    await page.evaluate(() => {
      window.__undercut?.teleport(460, 0, 300);
      window.__undercut?.drivingLine('braking');
    });
    await waitFrames(2);
    const warmOn = await countWarmPixels();

    await page.evaluate(() => {
      window.__undercut?.drivingLine('off');
    });
    await waitFrames(2);
    const warmOff = await countWarmPixels();

    expect(warmOn).toBeGreaterThan(warmOff + 80);
    expect(problems).toEqual([]);
  });

  test('a clumsy keyboard lap on the default assists completes without a spin', async ({
    drive: { page, problems },
  }) => {
    // The keyboard autopilot as a clumsy player (late and early braking, flooring the throttle
    // before the exits, slow feet), through the real key events, shaping and assists. The same
    // seed spins with the stability assist off (apps/web/test/clumsy-lap.test.ts).
    const before = (await state(page)).spins as number;
    await page.evaluate(() => {
      window.__undercut?.clumsyPilot(3);
      window.__undercut?.setTimeScale(8);
    });
    let lastLap: number | null = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && lastLap === null) {
      lastLap = ((await state(page)).lastLap as number | null | undefined) ?? null;
      if (lastLap === null) await page.waitForTimeout(200);
    }
    const after = await state(page);
    expect(lastLap).not.toBeNull();
    expect((after.spins as number) - before).toBe(0);
    expect(after.safetyResets).toBe(0);
    expect(problems).toEqual([]);
  });
});
