import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_GAMEPAD_SHAPING, DEFAULT_TOUCH_SHAPING, applyAxisCurve } from '@undercut/input';

import type { ControlInput, DeviceKind } from '@undercut/input';

/** What the lab's read-only test hook returns (apps/web/src/input-lab/main.ts). */
interface Snapshot {
  control: ControlInput;
  device: DeviceKind;
  lookBack: boolean;
  shifts: { up: number; down: number };
  log: string[];
  tick: number;
  pads: string[];
}
type LabWindow = Window & { inputLab?: { snapshot(): Snapshot } };

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function open(page: Page): Promise<void> {
  await page.goto('/input-lab.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready', '');
}

function snap(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const lab = (window as LabWindow).inputLab;
    if (!lab) throw new Error('input lab hook missing');
    return lab.snapshot();
  });
}

/** Wait until the sim has run at least `ticks` more steps. */
async function settle(page: Page, ticks = 24): Promise<void> {
  const start = (await snap(page)).tick;
  await expect.poll(async () => (await snap(page)).tick).toBeGreaterThanOrEqual(start + ticks);
}

test.describe('input lab, desktop', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'keyboard and gamepad run on desktop');
  });

  test('keyboard drives throttle, steering and exactly one gear shift per press', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await open(page);
    await expect(page.locator('[data-field=device]')).toHaveText('Keyboard');

    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyA');
    await expect.poll(async () => (await snap(page)).control.throttle).toBe(1);
    await expect.poll(async () => (await snap(page)).control.steer).toBe(1);
    await expect(page.locator('[data-field=throttle]')).toHaveText('100 %');
    await expect(page.locator('[data-field=steer]')).toHaveText('100 L');

    await page.keyboard.press('KeyE');
    await settle(page);
    await page.keyboard.down('KeyQ');
    await settle(page, 60);
    await page.keyboard.up('KeyQ');
    expect((await snap(page)).shifts).toEqual({ up: 1, down: 1 });

    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyA');
    await expect.poll(async () => (await snap(page)).control.throttle).toBe(0);
    await expect.poll(async () => (await snap(page)).control.steer).toBe(0);
    expect(errors).toEqual([]);
  });

  test('losing focus releases a held key', async ({ page }) => {
    await open(page);
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await snap(page)).control.throttle).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(async () => (await snap(page)).control.throttle).toBe(0);
    await settle(page);
    expect((await snap(page)).control.throttle).toBe(0);
    await page.keyboard.up('KeyW');
  });

  test('bound keys do not scroll the page while driving; others pass through', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const seen: Record<string, boolean> = {};
      window.addEventListener('keydown', (e) => (seen[e.code] = e.defaultPrevented));
      (window as unknown as { seen: Record<string, boolean> }).seen = seen;
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await page.keyboard.press('KeyZ');
    const seen = await page.evaluate(
      () => (window as unknown as { seen: Record<string, boolean> }).seen,
    );
    expect(seen).toEqual({ ArrowDown: true, Space: true, KeyZ: false });
  });

  test('rebinds a key, moves it off a conflicting action and keeps it after reload', async ({
    page,
  }) => {
    await open(page);
    const gearUp = page.locator('[data-action=gearUp][data-slot="0"]');
    await expect(gearUp).toHaveText('E');
    await gearUp.click();
    await expect(gearUp).toHaveText('Press a key');
    await page.keyboard.press('KeyK');
    await expect(gearUp).toHaveText('K');
    await expect(page.locator('[data-field=notice]')).toHaveText('Gear up: K.');

    await page.keyboard.press('KeyK');
    await expect.poll(async () => (await snap(page)).shifts.up).toBe(1);

    const drs = page.locator('[data-action=drs][data-slot="0"]');
    await drs.click();
    await page.keyboard.press('KeyK');
    await expect(drs).toHaveText('K');
    await expect(gearUp).toHaveText('Not set');
    await expect(page.locator('[data-field=notice]')).toHaveText('K moved here from Gear up.');

    // Esc cancels a capture without binding anything.
    await gearUp.click();
    await page.keyboard.press('Escape');
    await expect(gearUp).toHaveText('Not set');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', '');
    await expect(page.locator('[data-action=drs][data-slot="0"]')).toHaveText('K');
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(page.locator('[data-action=gearUp][data-slot="0"]')).toHaveText('E');
  });

  test('reads an injected gamepad: stick, analog triggers, buttons and hot-plug', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      type Pad = {
        index: number;
        id: string;
        connected: boolean;
        mapping: string;
        timestamp: number;
        axes: number[];
        buttons: { pressed: boolean; touched: boolean; value: number }[];
      };
      const pads: (Pad | null)[] = [null, null, null, null];
      const control = {
        connect(id: string) {
          const pad: Pad = {
            index: 0,
            id,
            connected: true,
            mapping: 'standard',
            timestamp: 0,
            axes: [0, 0, 0, 0],
            buttons: Array.from({ length: 17 }, () => ({
              pressed: false,
              touched: false,
              value: 0,
            })),
          };
          pads[0] = pad;
          window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
        },
        disconnect() {
          const pad = pads[0];
          pads[0] = null;
          window.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: pad }));
        },
        button(i: number, value: number) {
          const pad = pads[0];
          if (pad) pad.buttons[i] = { pressed: value > 0.5, touched: value > 0, value };
        },
        axis(i: number, value: number) {
          const pad = pads[0];
          if (pad) pad.axes[i] = value;
        },
      };
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () =>
          pads.map((p) => (p ? { ...p, axes: [...p.axes], buttons: [...p.buttons] } : null)),
      });
      (window as unknown as { fakePad: typeof control }).fakePad = control;
    });
    await open(page);
    const pad = (script: string): Promise<void> =>
      page.evaluate(`window.fakePad.${script}`) as Promise<void>;

    await pad(`connect('Test pad (STANDARD GAMEPAD)')`);
    await expect
      .poll(async () => (await snap(page)).log)
      .toContain('Gamepad connected: Test pad (STANDARD GAMEPAD)');
    // Connecting is not using: the keyboard keeps the prompts until the pad is pressed.
    expect((await snap(page)).device).toBe('keyboard');

    await pad('button(0, 1)');
    await expect.poll(async () => (await snap(page)).device).toBe('gamepad');
    await expect(page.locator('[data-field=device]')).toHaveText('Gamepad');
    await pad('button(0, 0)');

    await pad('axis(0, -0.5)');
    await pad('button(7, 0.6)');
    await pad('button(6, 0.3)');
    await settle(page);
    const control = (await snap(page)).control;
    expect(control.steer).toBeCloseTo(applyAxisCurve(0.5, DEFAULT_GAMEPAD_SHAPING.stick), 9);
    expect(control.throttle).toBeCloseTo(applyAxisCurve(0.6, DEFAULT_GAMEPAD_SHAPING.trigger), 9);
    expect(control.brake).toBeCloseTo(applyAxisCurve(0.3, DEFAULT_GAMEPAD_SHAPING.trigger), 9);
    await expect(page.locator('[data-field=rt]')).toHaveText('60 %');

    // RB held across many ticks is one gear shift.
    await pad('button(5, 1)');
    await settle(page, 60);
    await pad('button(5, 0)');
    await settle(page);
    expect((await snap(page)).shifts.up).toBe(1);

    await pad('disconnect()');
    await expect
      .poll(async () => (await snap(page)).log)
      .toContain('Gamepad disconnected: Test pad (STANDARD GAMEPAD)');
    await expect.poll(async () => (await snap(page)).device).toBe('keyboard');
    await expect.poll(async () => (await snap(page)).control.throttle).toBe(0);
    expect(errors).toEqual([]);
  });

  test('fits the viewport with no touch overlay on a desktop', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-testid=touch-overlay]')).toHaveCount(0);
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const { innerWidth: w, innerHeight: h } = window;
      const root = document.documentElement;
      if (root.scrollWidth > w || root.scrollHeight > h) out.push('page scrolls');
      for (const el of document.querySelectorAll<HTMLElement>('#lab *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (el.closest('.binds') && el !== el.closest('.binds')) continue;
        if (r.left < 0 || r.top < 0 || r.right > w + 0.5 || r.bottom > h + 0.5) {
          out.push(`${el.tagName.toLowerCase()}.${el.className} leaves the viewport`);
        }
      }
      return out;
    });
    expect(problems).toEqual([]);
  });
});

test.describe('input lab, phone', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'phone', 'touch runs on the phone project');
  });

  type Box = { x: number; y: number; width: number; height: number };
  async function box(page: Page, control: string): Promise<Box> {
    const b = await page.locator(`[data-control=${control}]`).boundingBox();
    if (!b) throw new Error(`no box for ${control}`);
    return b;
  }

  test('steers and drives the throttle together, and a gear tap disturbs neither', async ({
    page,
    context,
  }) => {
    const errors = watchErrors(page);
    await open(page);
    expect((await snap(page)).device).toBe('touch');
    const steer = await box(page, 'steer');
    const throttle = await box(page, 'throttle');
    const gear = await box(page, 'gearUp');
    const cdp = await context.newCDPSession(page);
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: { x: number; y: number; id: number }[],
    ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

    const origin = { x: steer.x + steer.width / 2, y: steer.y + steer.height / 2, id: 1 };
    const pedal = { x: throttle.x + throttle.width / 2, y: throttle.y + 8, id: 2 };
    const half = DEFAULT_TOUCH_SHAPING.stickRadius / 2;
    const steered = { ...origin, x: origin.x - half };
    const expectedSteer = applyAxisCurve(0.5, DEFAULT_TOUCH_SHAPING.stick);

    await touch('touchStart', [origin]);
    await touch('touchStart', [origin, pedal]);
    await touch('touchMove', [steered, pedal]);
    await expect.poll(async () => (await snap(page)).control.throttle).toBe(1);
    await expect.poll(async () => (await snap(page)).control.steer).toBeCloseTo(expectedSteer, 9);

    // CDP lists the points that change: touchEnd names the fingers that lift.
    // Third finger taps gear up while the other two stay down.
    const tap = { x: gear.x + gear.width / 2, y: gear.y + gear.height / 2, id: 3 };
    await touch('touchStart', [steered, pedal, tap]);
    await touch('touchEnd', [tap]);
    await expect.poll(async () => (await snap(page)).shifts.up).toBe(1);
    await settle(page);
    let s = await snap(page);
    expect(s.shifts).toEqual({ up: 1, down: 0 });
    expect(s.control.throttle).toBe(1);
    expect(s.control.steer).toBeCloseTo(expectedSteer, 9);

    // Lifting the throttle finger leaves the steering where it is.
    await touch('touchEnd', [pedal]);
    await expect.poll(async () => (await snap(page)).control.throttle).toBe(0);
    s = await snap(page);
    expect(s.control.steer).toBeCloseTo(expectedSteer, 9);

    await touch('touchEnd', [steered]);
    await expect.poll(async () => (await snap(page)).control.steer).toBe(0);
    expect(errors).toEqual([]);
  });

  test('draws the touch overlay inside the viewport, clear of the lab panels', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-testid=touch-overlay]')).toBeVisible();
    const report = await page.evaluate(() => {
      const problems: string[] = [];
      const { innerWidth: w, innerHeight: h } = window;
      const root = document.documentElement;
      if (root.scrollWidth > w) problems.push(`page is ${root.scrollWidth}px wide`);
      if (root.scrollHeight > h) problems.push(`page is ${root.scrollHeight}px tall`);
      const controls = [...document.querySelectorAll<HTMLElement>('[data-control]')];
      const visible = [...document.querySelectorAll<HTMLElement>('.lab-head, .panel--output')];
      for (const el of [...controls, ...visible]) {
        const r = el.getBoundingClientRect();
        const name = el.dataset.control ?? el.className;
        if (r.left < 0 || r.top < 0 || r.right > w + 0.5 || r.bottom > h + 0.5) {
          problems.push(`${name} leaves the viewport`);
        }
        if (el.dataset.control && (r.width < 48 || r.height < 48)) {
          problems.push(`${name} is smaller than 48 px`);
        }
      }
      for (const c of controls) {
        const a = c.getBoundingClientRect();
        for (const v of visible) {
          const b = v.getBoundingClientRect();
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            problems.push(`${c.dataset.control} overlaps ${v.className}`);
          }
        }
      }
      return problems;
    });
    expect(report).toEqual([]);
  });
});
