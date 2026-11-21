import type { BrowserContext, Page } from '@playwright/test';
import { expect, test as base } from './base';
import { openMenu, watchProblems } from './helpers';

/**
 * One browser context per worker for the menu tests (set up under its own fixture timeout, as
 * the drive tests share their session), and a fresh page in it for each test with the page's
 * storage cleared first, so every test starts from the defaults as with a new context. On a
 * busy CI runner a new context made right after a software-WebGL test closed its own can take
 * tens of seconds; these DOM-only tests should not pay that inside their own time.
 */
const test = base.extend<object, { menuContext: BrowserContext }>({
  menuContext: [
    async ({ browser }, use, workerInfo) => {
      const u = workerInfo.project.use;
      const context = await browser.newContext({
        viewport: u.viewport ?? null,
        deviceScaleFactor: u.deviceScaleFactor ?? 1,
        isMobile: u.isMobile ?? false,
        hasTouch: u.hasTouch ?? false,
        baseURL: u.baseURL ?? `http://127.0.0.1:${process.env.TEST_PORT ?? 4173}`,
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker', timeout: 90_000 },
  ],
  page: async ({ menuContext }, use) => {
    const page = await menuContext.newPage();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await use(page);
    await page.close();
  },
});

/**
 * The menus with each input device alone: keyboard only, an injected gamepad only, touch only.
 * Every control on a screen is reachable from where focus starts by moving in the four
 * directions; focus is never lost; Back always leads somewhere. Layout fits with nothing
 * clipped at 1440 x 900, 844 x 390 and 1280 x 720. No WebGL: these run on the DOM alone.
 */

/** Replace navigator.getGamepads with one scriptable standard pad, driven by window.fakePad. */
async function installFakePad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Button = { pressed: boolean; touched: boolean; value: number };
    const pad = {
      index: 0,
      id: 'Test pad (STANDARD GAMEPAD)',
      connected: false,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (): Button => ({
        pressed: false,
        touched: false,
        value: 0,
      })),
    };
    const control = {
      connect() {
        pad.connected = true;
        window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
      },
      button(i: number, value: number) {
        pad.buttons[i] = { pressed: value > 0.5, touched: value > 0, value };
      },
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [
        pad.connected ? { ...pad, axes: [...pad.axes], buttons: [...pad.buttons] } : null,
      ],
    });
    (window as unknown as { fakePad: typeof control }).fakePad = control;
  });
}

const frames = (page: Page, n = 3): Promise<void> =>
  page.evaluate(
    (k) =>
      new Promise<void>((resolve) => {
        let left = k;
        const step = (): void => {
          if (--left <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );

/** Press one pad button for one frame, then release it, in a single round-trip. */
async function padPress(page: Page, button: number): Promise<void> {
  await page.evaluate(
    (b) =>
      new Promise<void>((resolve) => {
        const pad = (window as unknown as { fakePad: { button(i: number, v: number): void } })
          .fakePad;
        pad.button(b, 1);
        requestAnimationFrame(() => {
          pad.button(b, 0);
          requestAnimationFrame(() => resolve());
        });
      }),
    button,
  );
}

const PAD = { a: 0, b: 1, lb: 4, rb: 5, up: 12, down: 13, left: 14, right: 15 } as const;

type Dir = 'up' | 'down' | 'left' | 'right';

/**
 * In the page: wait `frames` animation frames, read which control has focus (its DOM path),
 * then focus the control at `focus` (a DOM path, or null). One round trip does the read for the
 * previous step and the set-up for the next. With `pad`, it also presses that fake-pad button
 * for one frame after focusing and reads the result two frames later, so a pad step is a single
 * round trip.
 */
function step(
  page: Page,
  o: { frames: number; focus: string | null; pad?: number },
): Promise<{ before: string; after: string }> {
  return page.evaluate(async ({ frames, focus, pad }) => {
    const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
    const keyOf = (a: Element | null): string => {
      if (!(a instanceof HTMLElement) || a === document.body) return '';
      const path: string[] = [];
      for (let n: Element | null = a; n && n !== document.body; n = n.parentElement) {
        const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0;
        path.unshift(`${n.tagName}:${i}`);
      }
      return path.join('/');
    };
    for (let i = 0; i < frames; i++) await raf();
    const before = keyOf(document.activeElement);
    if (focus !== null) {
      let n: Element = document.body;
      for (const p of focus.split('/')) n = n.children[Number(p.split(':')[1])] as Element;
      (n as HTMLElement).focus();
    }
    let after = '';
    if (pad !== undefined) {
      const fake = (window as unknown as { fakePad: { button(i: number, v: number): void } })
        .fakePad;
      fake.button(pad, 1);
      await raf();
      fake.button(pad, 0);
      await raf();
      after = keyOf(document.activeElement);
    }
    return { before, after };
  }, o);
}

/**
 * Explore the screen's navigation graph with real input until every control is reached: from
 * each control reached so far, focus it and press each direction (a key through the browser's input pipeline, or the fake
 * pad's D-pad); record where focus lands. Returns the controls reached and all controls the
 * screen has.
 */
async function explore(page: Page, device: 'keyboard' | 'gamepad') {
  const all = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-nav]')]
      .filter(
        (el) =>
          el.getClientRects().length > 0 &&
          !el.closest('[hidden]') &&
          !(el as HTMLButtonElement).disabled,
      )
      .map((el) => {
        const path: string[] = [];
        for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
          const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0;
          path.unshift(`${n.tagName}:${i}`);
        }
        return path.join('/');
      }),
  );
  const { before: start } = await step(page, { frames: 0, focus: null });
  expect(all, 'focus starts on a control').toContain(start);
  const seen = new Set([start]);
  const queue = [start];
  let pending: { from: string; dir: Dir } | null = null;
  const record = (from: string, dir: Dir, now: string): void => {
    expect(now, `focus lost after ${dir} from ${from}`).not.toBe('');
    expect(all, `focus left the screen's controls after ${dir}`).toContain(now);
    if (!seen.has(now)) {
      seen.add(now);
      queue.push(now);
    }
  };
  // Until every control has been reached; every press on the way must keep focus on a control.
  while (queue.length > 0 && seen.size < all.length) {
    const key = queue.shift() as string;
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      if (seen.size >= all.length) break;
      if (device === 'gamepad') {
        const r = await step(page, { frames: 0, focus: key, pad: PAD[dir] });
        record(key, dir, r.after);
        continue;
      }
      // Keyboard: this call reads the previous press's result and focuses for the next.
      const r = await step(page, { frames: pending ? 1 : 0, focus: key });
      if (pending) record(pending.from, pending.dir, r.before);
      await page.keyboard.press(KEYS[dir]);
      pending = { from: key, dir };
    }
    if (pending && (queue.length === 0 || seen.size >= all.length)) {
      const r = await step(page, { frames: 1, focus: null });
      record(pending.from, pending.dir, r.before);
      pending = null;
    }
  }
  return { reached: [...seen].sort(), all: [...all].sort() };
}

const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;

test.describe('menus, keyboard only', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'keyboard runs on desktop');
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('every control on the main menu and circuit select is reachable with the arrows', async ({
    page,
  }) => {
    const problems = watchProblems(page);
    await page.goto('/');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    const hub = await explore(page, 'keyboard');
    expect(hub.reached).toEqual(hub.all);
    expect(hub.all.length).toBeGreaterThan(20);

    // Q and E step through the modes; the notice replaces the settings for race modes.
    await page.keyboard.press('KeyE');
    await expect(page.locator('[data-action=mode-quickRace]')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.locator('[data-testid=mode-notice]')).toBeVisible();
    await expect(page.locator('[data-action=start]')).toBeDisabled();
    await page.keyboard.press('KeyQ');
    await expect(page.locator('[data-action=mode-timeTrial]')).toHaveAttribute(
      'aria-current',
      'true',
    );

    // Change circuit, then Esc back with focus where it was.
    await page.locator('[data-action=change-circuit]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'circuits');
    const circuits = await explore(page, 'keyboard');
    expect(circuits.reached).toEqual(circuits.all);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    await expect(page.locator('[data-action=change-circuit]')).toBeFocused();
    // Esc from the main menu goes back to the launch screen.
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'launch');
    expect(problems).toEqual([]);
  });

  test('settings change with the keyboard and persist across a reload', async ({ page }) => {
    await page.goto('/');
    await openMenu(page);
    const tc = page.locator('.settings [data-setting=tractionControl]');
    await tc.locator('[data-value="3"]').focus();
    await page.keyboard.press('Enter');
    await expect(tc.locator('[data-value="3"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('.team[data-team=kestrel]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.team[data-team=kestrel]')).toHaveAttribute('aria-checked', 'true');
    await page.reload();
    await openMenu(page);
    await expect(
      page.locator('.settings [data-setting=tractionControl] [data-value="3"]'),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.team[data-team=kestrel]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.actionbar__summary')).toContainText('Kestrel Grand Prix');
  });
});

test.describe('menus, gamepad only', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'the injected pad runs on desktop');
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('a pad opens the menu, moves with the D-pad, switches modes on the shoulders and backs out', async ({
    page,
  }) => {
    const problems = watchProblems(page);
    await installFakePad(page);
    await page.goto('/');
    await page.evaluate(() =>
      (window as unknown as { fakePad: { connect(): void } }).fakePad.connect(),
    );
    await frames(page, 4);
    await padPress(page, PAD.a);
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    // The prompts follow the pad.
    await expect(page.locator('html')).toHaveAttribute('data-device', 'gamepad');
    await expect(page.locator('[data-action=start] .glyph')).toHaveText('A');
    await expect(page.locator('[data-action=back] .glyph')).toHaveText('B');
    await expect(page.locator('[data-testid=device-chip]')).toContainText('Gamepad');

    const hub = await explore(page, 'gamepad');
    expect(hub.reached).toEqual(hub.all);

    await padPress(page, PAD.rb);
    await expect(page.locator('[data-action=mode-quickRace]')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await padPress(page, PAD.lb);
    await expect(page.locator('[data-action=mode-timeTrial]')).toHaveAttribute(
      'aria-current',
      'true',
    );

    // A on a team picks it.
    await page.locator('.team[data-team=sable]').focus();
    await padPress(page, PAD.a);
    await expect(page.locator('.team[data-team=sable]')).toHaveAttribute('aria-checked', 'true');

    await page.locator('[data-action=change-circuit]').focus();
    await padPress(page, PAD.a);
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'circuits');
    await padPress(page, PAD.a);
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    await padPress(page, PAD.b);
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'launch');
    expect(problems).toEqual([]);
  });
});

test.describe('menus, touch only', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'phone', 'touch runs on the phone project');
  });

  test('taps reach every screen, the settings dialog and back', async ({ page }) => {
    const problems = watchProblems(page);
    await page.goto('/');
    await page.locator('.launch__stage').tap();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    // On a phone the settings are a summary line with an edit button.
    await expect(page.locator('.settings')).toBeHidden();
    await page.locator('[data-action=edit-settings]').tap();
    const dialog = page.locator('[data-testid=settings-dialog]');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-setting=gears] [data-value=manual]').tap();
    await expect(dialog.locator('[data-setting=gears] [data-value=manual]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await dialog.locator('[data-action=dialog-close]').tap();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.settings-summary__vals')).toContainText('Touch assists');

    await page.locator('[data-action=mode-weekend]').tap();
    await expect(page.locator('[data-testid=mode-notice]')).toBeVisible();
    await page.locator('[data-action=mode-timeTrial]').tap();
    await page.locator('.team[data-team=orrin]').tap();
    await page.locator('.driver[data-driver="1"]').tap();
    await expect(page.locator('.driver[data-driver="1"]')).toHaveAttribute('aria-checked', 'true');

    await page.locator('[data-action=change-circuit]').tap();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'circuits');
    await page.locator('.ccard[data-circuit=monza]').tap();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    await page.locator('[data-action=back]').tap();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'launch');
    expect(problems).toEqual([]);
  });
});

/**
 * In the page, for each step: click the selector (if any; the menus render synchronously), then
 * list anything outside the viewport or clipping its content, labelled by the step. One round
 * trip for a whole screen's states: these checks are about layout, not input (the device tests
 * above drive the same controls with real input).
 */
function layoutSweep(
  page: Page,
  steps: readonly { label: string; click?: string }[],
): Promise<string[]> {
  return page.evaluate((list) => {
    const problems: string[] = [];
    const { innerWidth: w, innerHeight: h } = window;
    const root = document.documentElement;
    for (const { label, click } of list) {
      if (click) {
        const target = document.querySelector<HTMLElement>(click);
        if (!target) {
          problems.push(`${label}: no ${click}`);
          continue;
        }
        target.click();
      }
      if (root.scrollWidth > w) problems.push(`${label}: page is ${root.scrollWidth}px wide`);
      if (root.scrollHeight > h) problems.push(`${label}: page is ${root.scrollHeight}px tall`);
      for (const el of document.querySelectorAll<HTMLElement>('#app *')) {
        if (el.closest('[hidden]') || el.getClientRects().length === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.position === 'fixed') continue;
        // Tooltips sit outside their control by design and show only on hover or focus.
        if (el.closest('.tip')) continue;
        const r = el.getBoundingClientRect();
        const name = `${label}: ${el.tagName.toLowerCase()}.${String(el.className)}`;
        if (
          r.width > 0 &&
          (r.left < -0.5 || r.top < -0.5 || r.right > w + 0.5 || r.bottom > h + 0.5)
        ) {
          problems.push(
            `${name} leaves the viewport (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`,
          );
        }
        const clipsX = el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible';
        const clipsY =
          el.scrollHeight > el.clientHeight + 1 &&
          style.overflowY !== 'visible' &&
          style.overflowY !== 'auto';
        if (clipsX || clipsY) problems.push(`${name} clips its content`);
      }
    }
    return problems;
  }, steps);
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 844, height: 390 },
]) {
  test(`every menu screen fits ${size.width} x ${size.height} with nothing clipped`, async ({
    page,
  }) => {
    test.skip(
      test.info().project.name !== (size.height < 500 ? 'phone' : 'desktop'),
      'one project per size',
    );
    // No transitions: each state is measured as it settles.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(size);
    await page.goto('/');
    expect(await layoutSweep(page, [{ label: 'launch' }])).toEqual([]);
    await openMenu(page);
    const hub = [
      ...['timeTrial', 'quickRace', 'weekend', 'championship', 'online'].map((m) => ({
        label: `main menu, ${m}`,
        click: `[data-action=mode-${m}]`,
      })),
      { label: 'main menu, time trial again', click: '[data-action=mode-timeTrial]' },
      ...['norrland', 'terraluce', 'aldermoor', 'quillon'].flatMap((t) => [
        { label: `main menu, ${t}`, click: `.team[data-team=${t}]` },
        { label: `main menu, ${t} second driver`, click: '.driver[data-driver="1"]' },
      ]),
      ...(size.height < 500
        ? [
            { label: 'settings dialog', click: '[data-action=edit-settings]' },
            {
              label: 'settings dialog closed',
              click: '[data-testid=settings-dialog] [data-action=dialog-close]',
            },
          ]
        : []),
      { label: 'circuit select', click: '[data-action=change-circuit]' },
    ];
    expect(await layoutSweep(page, hub)).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'circuits');
  });
}

test('reduced motion removes transitions and screen animations', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openMenu(page);
  const motion = await page.evaluate(() => {
    const btn = document.querySelector('[data-action=start]') as HTMLElement;
    const screen = document.querySelector('.screen') as HTMLElement;
    return {
      transition: getComputedStyle(btn).transitionDuration,
      animation: getComputedStyle(screen).animationName,
    };
  });
  expect(motion.transition.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
  expect(motion.animation).toBe('none');
});

test('the living interface gallery renders tokens, icons, glyphs and components', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  const problems = watchProblems(page);
  await page.goto('/ui-gallery.html');
  expect(await page.locator('.icon-cell').count()).toBeGreaterThanOrEqual(40);
  await page.locator('[data-setting=gallery-device] [data-value=gamepad]').click();
  await expect(page.locator('html')).toHaveAttribute('data-device', 'gamepad');
  await expect(page.locator('.glyph-cell [data-glyph=menuAccept]')).toHaveText('A');
  await page.locator('[data-setting=gallery-cb] [data-value=on]').click();
  await expect(page.locator('html')).toHaveAttribute('data-cb', 'on');
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.locator('[data-testid=gallery-dialog]')).toBeVisible();
  await page.locator('[data-testid=gallery-dialog] [data-action=dialog-close]').click();
  await expect(page.locator('[data-testid=gallery-dialog]')).toBeHidden();
  expect(problems).toEqual([]);
});
