import { expect, test, type Page } from '@playwright/test';
import { openMenu, watchProblems } from './helpers';

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

/** Press one pad button for two frames, then release it, in a single round-trip. */
async function padPress(page: Page, button: number): Promise<void> {
  await page.evaluate(
    (b) =>
      new Promise<void>((resolve) => {
        const pad = (window as unknown as { fakePad: { button(i: number, v: number): void } })
          .fakePad;
        pad.button(b, 1);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            pad.button(b, 0);
            requestAnimationFrame(() => resolve());
          }),
        );
      }),
    button,
  );
}

const PAD = { a: 0, b: 1, lb: 4, rb: 5, up: 12, down: 13, left: 14, right: 15 } as const;

/** A stable name for the focused control. */
const focusedKey = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return '';
    const path: string[] = [];
    for (let n: Element | null = a; n && n !== document.body; n = n.parentElement) {
      const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0;
      path.unshift(`${n.tagName}:${i}`);
    }
    return path.join('/');
  });

/**
 * Explore the screen's navigation graph with real input: from each control reached so far,
 * focus it and press each direction; record where focus lands. Returns the controls reached and
 * all controls the screen has.
 */
async function explore(
  page: Page,
  press: (dir: 'up' | 'down' | 'left' | 'right') => Promise<void>,
) {
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
  const start = await focusedKey(page);
  expect(all, 'focus starts on a control').toContain(start);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      await page.evaluate((k) => {
        const parts = k.split('/');
        let n: Element = document.body;
        for (const p of parts) n = n.children[Number(p.split(':')[1])] as Element;
        (n as HTMLElement).focus();
      }, key);
      await press(dir);
      const now = await focusedKey(page);
      expect(now, `focus lost after ${dir} from ${key}`).not.toBe('');
      expect(all, `focus left the screen's controls after ${dir}`).toContain(now);
      if (!seen.has(now)) {
        seen.add(now);
        queue.push(now);
      }
    }
  }
  return { reached: [...seen].sort(), all: [...all].sort() };
}

const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' } as const;

test.describe('menus, keyboard only', () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'keyboard runs on desktop');
  });

  test('every control on the main menu and circuit select is reachable with the arrows', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const problems = watchProblems(page);
    await page.goto('/');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    const press = async (dir: keyof typeof KEYS): Promise<void> => {
      await page.keyboard.press(KEYS[dir]);
      await frames(page, 1);
    };
    const hub = await explore(page, press);
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
    const circuits = await explore(page, press);
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
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop', 'the injected pad runs on desktop');
  });

  test('a pad opens the menu, moves with the D-pad, switches modes on the shoulders and backs out', async ({
    page,
  }) => {
    test.setTimeout(60_000);
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

    const hub = await explore(page, (dir) => padPress(page, PAD[dir]));
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

/** Anything outside the viewport, or clipping its content, on the current screen. */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.allSettled(finite.map((a) => a.finished));
    const problems: string[] = [];
    const { innerWidth: w, innerHeight: h } = window;
    const root = document.documentElement;
    if (root.scrollWidth > w) problems.push(`page is ${root.scrollWidth}px wide in ${w}px`);
    if (root.scrollHeight > h) problems.push(`page is ${root.scrollHeight}px tall in ${h}px`);
    for (const el of document.querySelectorAll<HTMLElement>('#app *')) {
      if (el.closest('[hidden]') || el.getClientRects().length === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.position === 'fixed') continue;
      // Tooltips sit outside their control by design and show only on hover or focus.
      if (el.closest('.tip')) continue;
      const r = el.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()}.${String(el.className)}`;
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
    return problems;
  });
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
    await page.setViewportSize(size);
    await page.goto('/');
    expect(await layoutProblems(page), 'launch').toEqual([]);
    await openMenu(page);
    for (const mode of ['timeTrial', 'quickRace', 'weekend', 'championship', 'online']) {
      await page.locator(`[data-action=mode-${mode}]`).click();
      expect(await layoutProblems(page), `main menu, ${mode}`).toEqual([]);
    }
    await page.locator('[data-action=mode-timeTrial]').click();
    for (const team of ['norrland', 'terraluce', 'aldermoor', 'quillon']) {
      await page.locator(`.team[data-team=${team}]`).click();
      expect(await layoutProblems(page), `main menu, ${team}`).toEqual([]);
    }
    if (size.height < 500) {
      await page.locator('[data-action=edit-settings]').click();
      expect(await layoutProblems(page), 'settings dialog').toEqual([]);
      await page.locator('[data-testid=settings-dialog] [data-action=dialog-close]').click();
    }
    await page.locator('[data-action=change-circuit]').click();
    expect(await layoutProblems(page), 'circuit select').toEqual([]);
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
