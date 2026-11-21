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

    // Steering left turns the car left (yaw grows).
    await page.evaluate(() => window.__undercut?.drive({ throttle: 0.3, steer: 0.4 }));
    await expect
      .poll(async () => {
        const t = await telemetry(page);
        return Math.atan2(Math.sin(t.yaw - fast.yaw), Math.cos(t.yaw - fast.yaw));
      })
      .toBeGreaterThan(0.02);

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
      u?.teleport(5560, 0, 250);
      u?.autopilot(true);
      u?.setTimeScale(4);
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
            u?.camera(camera as string);
            const p = at as { restart?: boolean; s?: number; kmh?: number };
            if (p.restart) u?.restartLap();
            else u?.teleport(p.s ?? 0, 0, p.kmh ?? 0);
            u?.drive({ throttle: 0.6, steer: 0 });
          },
          [camera, at] as const,
        );
        // Cameras settle on real time; wait for the framing to converge.
        await page.waitForTimeout(1500);
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
});
