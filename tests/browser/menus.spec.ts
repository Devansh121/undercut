import type { Page } from '@playwright/test';
import { expect, test } from './base';
import { openMenu, watchProblems } from './helpers';

/**
 * The menus with each input device alone: keyboard only, an injected gamepad only, touch only.
 * Every control on a screen is reachable from where focus starts by moving in the four
 * directions; focus is never lost; Back always leads somewhere. Layout fits with nothing
 * clipped at 1440 x 900, 844 x 390 and 1280 x 720. No WebGL: these run on the DOM alone, so
 * they disable the GPU/SwiftShader process (their own clean worker, immune to software-WebGL
 * teardown and compositor readback stalls on CI).
 */
test.use({ launchOptions: { args: ['--disable-gpu'] } });

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
      axis(i: number, value: number) {
        pad.axes[i] = value;
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
 * previous keyboard press and the set-up for the next.
 */
function step(
  page: Page,
  o: { frames: number; focus: string | null },
): Promise<{ before: string }> {
  return page.evaluate(async ({ frames, focus }) => {
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
    return { before };
  }, o);
}

/**
 * Explore the screen's navigation graph with real input until every control is reached: from
 * each control reached so far, focus it and press each direction (a key through the browser's
 * input pipeline, or the fake pad's D-pad and left stick); record where focus lands. Returns
 * the controls reached and all controls the screen has.
 */
async function explore(page: Page, device: 'keyboard' | 'gamepad') {
  if (device === 'gamepad') {
    const res = await page.evaluate(async (padButtons) => {
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
      const focusKey = (path: string): void => {
        let n: Element = document.body;
        for (const p of path.split('/')) n = n.children[Number(p.split(':')[1])] as Element;
        (n as HTMLElement).focus();
      };
      const all = [...document.querySelectorAll<HTMLElement>('[data-nav]')]
        .filter(
          (el) =>
            el.getClientRects().length > 0 &&
            !el.closest('[hidden]') &&
            !(el as HTMLButtonElement).disabled,
        )
        .map((el) => keyOf(el));
      const allSet = new Set(all);
      const start = keyOf(document.activeElement);
      if (!allSet.has(start))
        return {
          error: `focus did not start on a control (${start})`,
          reached: [] as string[],
          all,
        };
      const fake = (
        window as unknown as {
          fakePad: { button(i: number, v: number): void; axis(i: number, v: number): void };
        }
      ).fakePad;
      const seen = new Set([start]);
      const queue = [start];
      let padSteps = 0;
      const dirs = ['up', 'down', 'left', 'right'] as const;
      while (queue.length > 0 && seen.size < all.length) {
        const key = queue.shift() as string;
        for (const dir of dirs) {
          if (seen.size >= all.length) break;
          focusKey(key);
          padSteps++;
          const useButton = padSteps % 2 === 0;
          const axis = dir === 'left' || dir === 'right' ? 0 : 1;
          const value = dir === 'left' || dir === 'up' ? -1 : 1;
          if (useButton) fake.button(padButtons[dir], 1);
          else fake.axis(axis, value);
          await raf();
          const now = keyOf(document.activeElement);
          if (useButton) fake.button(padButtons[dir], 0);
          else fake.axis(axis, 0);
          if (now === '')
            return { error: `focus lost after ${dir} from ${key}`, reached: [...seen], all };
          if (!allSet.has(now))
            return {
              error: `focus left the screen's controls after ${dir} (${now})`,
              reached: [...seen],
              all,
            };
          if (!seen.has(now)) {
            seen.add(now);
            queue.push(now);
          }
        }
      }
      // Let the final release frame settle.
      await raf();
      return { error: null as string | null, reached: [...seen].sort(), all: [...all].sort() };
    }, PAD);
    expect(res.error).toBeNull();
    return { reached: res.reached, all: res.all };
  }

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

  test('every control on the main menu is reachable with the arrows', async ({ page }) => {
    const problems = watchProblems(page);
    await page.goto('/');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    const hub = await explore(page, 'keyboard');
    expect(hub.reached).toEqual(hub.all);
    expect(hub.all.length).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  test('Q and E switch modes, circuit select is reachable with the arrows, Esc goes back', async ({
    page,
  }) => {
    const problems = watchProblems(page);
    await page.goto('/');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');

    // Q and E step through the modes; the notice replaces the settings for race modes. Quick
    // Race starts at Monza (the default circuit).
    await page.keyboard.press('KeyE');
    await expect(page.locator('[data-action=mode-quickRace]')).toHaveAttribute(
      'aria-current',
      'true',
    );
    await expect(page.locator('[data-testid=mode-notice]')).toBeVisible();
    await expect(page.locator('[data-action=start]')).toBeEnabled();
    await expect(page.locator('[data-action=start]')).toContainText('Start race');
    await page.keyboard.press('KeyE');
    await expect(page.locator('[data-action=start]')).toBeDisabled();
    await page.keyboard.press('KeyQ');
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

  /** Load the launch screen with one standard pad connected, and open the menu with A. */
  const padMenu = async (page: Page): Promise<void> => {
    await installFakePad(page);
    await page.goto('/');
    await page.evaluate(() =>
      (window as unknown as { fakePad: { connect(): void } }).fakePad.connect(),
    );
    await frames(page, 4);
    await padPress(page, PAD.a);
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
  };

  test('the D-pad and the stick reach every control on the main menu', async ({ page }) => {
    const problems = watchProblems(page);
    await padMenu(page);
    const hub = await explore(page, 'gamepad');
    expect(hub.reached).toEqual(hub.all);
    expect(hub.all.length).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  test('a pad opens the menu, switches modes on the shoulders, picks with A and backs out with B', async ({
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
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'phone', 'touch runs on the phone project');
    await page.emulateMedia({ reducedMotion: 'reduce' });
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
    // A phone steps through the teams one at a time.
    const teamName = page.locator('.team-switch__name b');
    const before = (await teamName.textContent()) ?? '';
    await page.locator('[data-action=team-next]').tap();
    await expect(teamName).not.toHaveText(before);
    await expect(page.locator('.team-car__img')).toBeVisible();
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
interface SweepStep {
  label: string;
  click?: string;
  /** Selectors that must be visible after this step, and ones that must not be. */
  shows?: string[];
  hides?: string[];
}

function layoutSweep(
  page: Page,
  steps: readonly SweepStep[],
  o: { minTarget?: number } = {},
): Promise<string[]> {
  return page.evaluate(
    ({ list, minTarget }) => {
      const problems: string[] = [];
      const { innerWidth: w, innerHeight: h } = window;
      const root = document.documentElement;
      const shown = (el: Element | null): boolean =>
        el instanceof HTMLElement && !el.closest('[hidden]') && el.getClientRects().length > 0;
      for (const { label, click, shows = [], hides = [] } of list) {
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
          // Touch targets: every control at least `minTarget` px in both directions.
          if (
            minTarget &&
            (el.matches('button, input, a, [data-nav]') || el.getAttribute('role') === 'slider') &&
            (r.width < minTarget - 0.5 || r.height < minTarget - 0.5)
          ) {
            problems.push(`${name} is a ${Math.round(r.width)} x ${Math.round(r.height)} target`);
          }
        }
        // Headings never break inside a word: each word sits on one line.
        for (const heading of document.querySelectorAll<HTMLElement>(
          '#app .circuit__name, #app .ccard__name, #app .lrow__title, #app .driver__last',
        )) {
          if (!shown(heading)) continue;
          const text = heading.firstChild;
          if (!(text instanceof Text)) continue;
          const range = document.createRange();
          for (const m of (text.data ?? '').matchAll(/[^\s-]+-?/g)) {
            range.setStart(text, m.index ?? 0);
            range.setEnd(text, (m.index ?? 0) + m[0].length);
            const lines = new Set([...range.getClientRects()].map((q) => Math.round(q.top)));
            if (lines.size > 1) problems.push(`${label}: "${m[0]}" breaks inside the word`);
          }
        }
        for (const sel of shows)
          if (!shown(document.querySelector(sel))) problems.push(`${label}: ${sel} is not shown`);
        for (const sel of hides)
          if (shown(document.querySelector(sel))) problems.push(`${label}: ${sel} is shown`);
      }
      return problems;
    },
    { list: steps, minTarget: o.minTarget ?? 0 },
  );
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
    // On a phone every control is a touch target of 44 px or more (docs/visual-direction.md).
    const minTarget = size.height < 500 ? 44 : 0;
    expect(await layoutSweep(page, [{ label: 'launch' }], { minTarget })).toEqual([]);
    await openMenu(page);
    const hub: SweepStep[] = [
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
      // Each circuit (long names, the Time Trial only mark), and a race mode at one of them.
      ...['spa', 'singapore', 'monza'].flatMap((c) => [
        { label: `circuit select before ${c}`, click: '[data-action=change-circuit]' },
        { label: `main menu at ${c}`, click: `.ccard[data-circuit=${c}]` },
      ]),
      { label: 'circuit select for a race mode', click: '[data-action=change-circuit]' },
      { label: 'main menu at spa again', click: '.ccard[data-circuit=spa]' },
      { label: 'quick race at spa', click: '[data-action=mode-quickRace]' },
      // Online the room assigns cars: no team picker, one line instead.
      {
        label: 'online rooms',
        click: '[data-action=mode-online]',
        shows: ['.team-card__note'],
        hides: ['.teams', '.team-switch', '.drivers', '[data-action=change-circuit]'],
      },
      { label: 'time trial once more', click: '[data-action=mode-timeTrial]' },
      { label: 'circuit select', click: '[data-action=change-circuit]' },
    ];
    expect(await layoutSweep(page, hub, { minTarget })).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'circuits');
  });
}

test('time of day follows the circuit, and each circuit keeps its own choice', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openMenu(page);
  const tod = page.locator('.settings [data-setting=timeOfDay]');
  const choices = tod.locator('[data-value]');
  const chip = page.locator('.circuit .chip').first();
  const pick = async (id: string): Promise<void> => {
    await page.locator('[data-action=change-circuit]').click();
    await page.locator(`.ccard[data-circuit=${id}]`).click();
  };
  // Monza: afternoon (default) or overcast.
  await expect(choices).toHaveCount(2);
  await expect(tod.locator('[data-value=monza-afternoon]')).toHaveAttribute('aria-checked', 'true');
  // Spa: the day preset only, and the chip and the summary agree with the control.
  await pick('spa');
  await expect(choices).toHaveCount(1);
  await expect(tod.locator('[data-value=overcast-day]')).toHaveAttribute('aria-checked', 'true');
  await expect(chip).toContainText('Overcast');
  await expect(page.locator('.actionbar__summary')).toContainText('Overcast');
  // Saved at Spa, after a reload, back at Monza: Monza's two presets again.
  await page.reload();
  await openMenu(page);
  await expect(choices).toHaveCount(1);
  await pick('monza');
  await expect(choices).toHaveCount(2);
  await expect(tod.locator('[data-value=monza-afternoon]')).toHaveAttribute('aria-checked', 'true');
  // Overcast at Monza is Monza's choice; Spa keeps its own.
  await tod.locator('[data-value=overcast-day]').click();
  await expect(chip).toContainText('Overcast');
  await pick('spa');
  await expect(tod.locator('[data-value=overcast-day]')).toHaveAttribute('aria-checked', 'true');
  await pick('monza');
  await expect(tod.locator('[data-value=overcast-day]')).toHaveAttribute('aria-checked', 'true');
});

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

test('the timing tower reorders from a scripted sequence of standings', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ui-gallery.html');
  const card = page.locator('[data-testid=gallery-tower]');
  const rows = card.locator('.hud-tower__row');
  const read = () =>
    rows.evaluateAll((lis) =>
      lis.map((li) => ({
        car: (li as HTMLElement).dataset.car,
        pos: li.querySelector('.hud-tower__pos')?.textContent,
        value: li.querySelector('.hud-tower__time')?.textContent,
        player: li.classList.contains('is-player'),
        fastest: li.classList.contains('is-fastest'),
        moved: (li as HTMLElement).style.transform,
      })),
    );
  const order = async () => (await read()).map((r) => r.car).join('');
  expect(await order()).toBe('abcdef');
  await expect(card.locator('.hud-tower__lap')).toContainText('12');
  // Lap 13: C passes B, the player passes E, E pits; C sets the fastest lap; a yellow.
  await card.locator('[data-action=tower-next]').click();
  expect(await order()).toBe('acbdfe');
  let now = await read();
  expect(now.map((r) => r.pos)).toEqual(['1', '2', '3', '4', '5', '6']);
  expect(now.find((r) => r.car === 'e')?.value).toBe('Pit');
  expect(now.find((r) => r.car === 'c')?.fastest).toBe(true);
  expect(now.find((r) => r.car === 'f')?.player).toBe(true);
  await expect(card.locator('.hud-tower__status')).toHaveAttribute('data-flag', 'yellow');
  // Lap 14: the player up to third and fastest; rows settle with no leftover offset.
  await card.locator('[data-action=tower-next]').click();
  expect(await order()).toBe('acfbde');
  now = await read();
  expect(now.find((r) => r.car === 'f')?.pos).toBe('3');
  expect(now.filter((r) => r.fastest).map((r) => r.car)).toEqual(['f']);
  expect(now.every((r) => r.moved === '')).toBe(true);
  // One node per car throughout: nothing was rebuilt.
  expect(await rows.count()).toBe(6);
});
