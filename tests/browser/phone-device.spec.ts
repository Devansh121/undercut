import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './base';
import { watchProblems } from './helpers';

/**
 * What a real phone needs that a desktop browser never exercises, on emulated phones: an
 * iPhone 15 on WebKit (`webkit-phone`, the engine of every iPhone browser) and a Pixel 8 on
 * Chromium (`pixel-phone`). The home-screen launch (icon, launch images, full-bleed viewport),
 * the landscape side bars (safe-area insets) around menus, HUD and touch controls, no zoom,
 * selection or callout on controls, audio that starts from a tap, and vibration for kerbs and
 * button presses with its setting. Scenes that need WebGL run on Chromium only: Playwright's
 * WebKit build has no usable WebGL here.
 *
 * A real device still has to confirm what emulation cannot: docs/real-phone-test.md.
 */

/** A landscape iPhone 15's safe-area insets, CSS px: the bars down both sides, the home bar. */
const INSETS = { l: 59, r: 59, t: 0, b: 21 };
/** The same phone upright: the status bar and Dynamic Island on top, the home bar below. */
const PORTRAIT_INSETS = { l: 0, r: 0, t: 59, b: 34 };

/**
 * Inset shapes the menus must clear. iPhones report symmetric side insets, but phones with an
 * off-centre camera do not, so one-sided bars are checked too. Upright matters as much as on its
 * side: a home-screen launch ignores the manifest's orientation, and the black-translucent status
 * bar puts the page under the Dynamic Island.
 */
const SHAPES = [
  { name: 'side bars', upright: false, insets: INSETS },
  { name: 'notch left', upright: false, insets: { l: 59, r: 0, t: 0, b: 21 } },
  { name: 'notch right', upright: false, insets: { l: 0, r: 59, t: 0, b: 21 } },
  { name: 'upright', upright: true, insets: PORTRAIT_INSETS },
];

const webkit = (name: string): boolean => name === 'webkit-phone';

/** Set the safe-area insets the CSS reads (styles.css `--inset-*`), as a notched phone would. */
async function setInsets(page: Page, i: typeof INSETS): Promise<void> {
  await page.evaluate((i) => {
    const s = document.documentElement.style;
    s.setProperty('--inset-l', `${i.l}px`);
    s.setProperty('--inset-r', `${i.r}px`);
    s.setProperty('--inset-t', `${i.t}px`);
    s.setProperty('--inset-b', `${i.b}px`);
    window.dispatchEvent(new Event('resize'));
  }, i);
}

/**
 * Every visible control and every visible run of text under `selector` that lies under a bar.
 * Backgrounds and full-bleed panels may run under the bars (they should); what the player reads
 * or presses may not.
 */
function underBars(page: Page, selector: string, i: typeof INSETS): Promise<string[]> {
  return page.evaluate(
    ({ selector, i }) => {
      const { innerWidth: w, innerHeight: h } = window;
      const out: string[] = [];
      const control = 'button, a, input, select, [role=slider], [data-nav], .ut-touch > *';
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (el.closest('[hidden], [aria-hidden=true]:not(.ut-touch)')) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || +style.opacity === 0)
          continue;
        const isControl = el.matches(control);
        const hasText = [...el.childNodes].some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
        if (!isControl && !hasText) continue;
        // What shows is the part its scroll boxes leave visible: a row scrolled out, or cut by
        // the bottom edge of a scrolling card, scrolls into view inside the safe area.
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        let [top, bottom] = [box.top, box.bottom];
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowY;
          if (o === 'auto' || o === 'scroll' || o === 'hidden') {
            const c = p.getBoundingClientRect();
            top = Math.max(top, c.top);
            bottom = Math.min(bottom, c.bottom);
          }
        }
        if (bottom - top < 0.5) continue;
        const r = { left: box.left, right: box.right, top, bottom };
        const bad =
          r.left < i.l - 0.5 ||
          r.right > w - i.r + 0.5 ||
          r.top < i.t - 0.5 ||
          r.bottom > h - i.b + 0.5;
        if (bad)
          out.push(
            `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent ?? '').trim().slice(0, 24)}" at ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)}`,
          );
      }
      return out;
    },
    { selector, i },
  );
}

/** Width and height from a PNG's IHDR. */
function pngSize(body: Buffer): [number, number] {
  return [body.readUInt32BE(16), body.readUInt32BE(20)];
}

test('home-screen launch: full-bleed viewport, icon, and a launch image for every iPhone', async ({
  page,
}, info) => {
  test.skip(!/^(webkit|pixel)-phone$/.test(info.project.name), 'device projects only');
  await page.goto('/');
  const head = await page.evaluate(() => {
    const meta = (name: string): string | null =>
      document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;
    return {
      viewport: meta('viewport'),
      capable: meta('apple-mobile-web-app-capable'),
      statusBar: meta('apple-mobile-web-app-status-bar-style'),
      icon: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href') ?? null,
      splash: [...document.querySelectorAll('link[rel=apple-touch-startup-image]')].map((l) => ({
        href: l.getAttribute('href')!,
        media: l.getAttribute('media')!,
        matches: matchMedia(l.getAttribute('media')!).matches,
      })),
    };
  });
  // Edge to edge under the notch and the status bar; the insets keep the interface clear.
  expect(head.viewport).toContain('viewport-fit=cover');
  expect(head.capable).toBe('yes');
  expect(head.statusBar).toBe('black-translucent');

  const icon = await page.request.get(head.icon!);
  expect(icon.headers()['content-type']).toContain('image/png');
  expect(pngSize(await icon.body())).toEqual([180, 180]);

  // Ten iPhone screen sizes, upright and on their side; each image is exactly that screen.
  expect(head.splash).toHaveLength(20);
  for (const s of head.splash) {
    const m =
      /device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: (\w+)\)/.exec(
        s.media,
      );
    expect(m, s.media).not.toBeNull();
    const [w, h, ratio] = [Number(m![1]), Number(m![2]), Number(m![3])];
    const want = m![4] === 'portrait' ? [w * ratio, h * ratio] : [h * ratio, w * ratio];
    const res = await page.request.get(s.href);
    expect(res.status(), s.href).toBe(200);
    expect(pngSize(await res.body()), s.href).toEqual(want);
  }
  // The emulated iPhone 15 picks exactly one (its own size, upright); the Pixel none.
  const matching = head.splash.filter((s) => s.matches).map((s) => s.href);
  if (webkit(info.project.name)) expect(matching).toEqual(['./splash/launch-1179x2556.png']);
  else expect(matching).toEqual([]);

  const manifest = (await (await page.request.get('/manifest.webmanifest')).json()) as {
    display: string;
    display_override: string[];
    orientation: string;
  };
  expect(manifest.display).toBe('fullscreen');
  expect(manifest.display_override).toContain('standalone');
  expect(manifest.orientation).toBe('landscape');
});

for (const shape of SHAPES) {
  test(`menus keep their text and controls clear of the bars (${shape.name})`, async ({
    page,
  }, info) => {
    test.skip(!/^(webkit|pixel)-phone$/.test(info.project.name), 'device projects only');
    const problems = watchProblems(page);
    const i = shape.insets;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const vp = page.viewportSize()!;
    const [long, short] = [Math.max(vp.width, vp.height), Math.min(vp.width, vp.height)];
    await page.setViewportSize(
      shape.upright ? { width: short, height: long } : { width: long, height: short },
    );
    await page.goto('/');
    await setInsets(page, i);
    await expect(page.locator('[data-action=press-start]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await underBars(page, 'body *', i), 'launch').toEqual([]);
    await page.locator('[data-action=press-start]').tap();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    expect(await underBars(page, 'body *', i), 'hub').toEqual([]);
    await page.locator('[data-action=mode-quickRace]').tap();
    expect(await underBars(page, 'body *', i), 'quick race').toEqual([]);
    const edit = page.locator('[data-action=edit-settings]');
    if (await edit.isVisible()) {
      await edit.tap();
      await expect(page.getByTestId('settings-dialog')).toBeVisible();
      expect(await underBars(page, 'body *', i), 'session settings').toEqual([]);
    }
    expect(problems).toEqual([]);
  });
}

test('no double-tap zoom, selection, callout or tap flash on the interface', async ({
  page,
}, info) => {
  test.skip(!/^(webkit|pixel)-phone$/.test(info.project.name), 'device projects only');
  await page.goto('/');
  await page.locator('[data-action=press-start]').tap();
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
  const style = await page.evaluate(() => {
    const button = document.querySelector<HTMLElement>('[data-action=start]')!;
    const text = document.querySelector<HTMLElement>('#app h1, #app h2, #app p, #app span')!;
    const css = (el: Element, prop: string): string =>
      getComputedStyle(el).getPropertyValue(prop) ||
      ((getComputedStyle(el) as unknown as Record<string, string>)[prop] ?? '');
    return {
      htmlTouch: css(document.documentElement, 'touch-action'),
      buttonSelect: css(button, 'user-select') || css(button, '-webkit-user-select'),
      textSelect: css(text, 'user-select') || css(text, '-webkit-user-select'),
      callout: CSS.supports('-webkit-touch-callout', 'none')
        ? css(button, '-webkit-touch-callout')
        : 'unsupported',
      tapFlash: css(document.documentElement, '-webkit-tap-highlight-color'),
    };
  });
  expect(style.htmlTouch).toBe('manipulation');
  expect(style.buttonSelect).toBe('none');
  expect(style.textSelect).toBe('none');
  expect(style.tapFlash).toBe('rgba(0, 0, 0, 0)');
  // The long-press callout property exists only in iOS WebKit, not in Chromium or the Linux
  // WebKit build here; docs/real-phone-test.md checks it on an iPhone.
  if (style.callout !== 'unsupported') expect(style.callout).toBe('none');
});

test('the Start tap creates the audio context inside the gesture', async ({ page }, info) => {
  test.skip(!webkit(info.project.name), 'WebKit: the Pixel session below covers Chromium');
  await page.goto('/?debug=1&quality=lite&world=lite');
  await page.locator('[data-action=press-start]').tap();
  await page.locator('[data-action=mode-timeTrial]').tap();
  expect(await page.evaluate(() => window.__undercut!.audioStatus())).toBe('none');
  await page.locator('[data-action=start]').tap();
  // Created by the tap itself (iOS Safari allows no later start), silent until the session runs.
  expect(await page.evaluate(() => window.__undercut!.audioStatus())).not.toBe('none');
  // No WebGL in this WebKit build: leave before the session tries to draw.
  await page.goto('about:blank');
});

/**
 * One Pixel 8 session, started with taps, shared by the steps below: a cold load on software
 * WebGL is the expensive part.
 */
test.describe('on an Android phone, driving', () => {
  test.describe.configure({ mode: 'serial' });
  let context: BrowserContext;
  let page: Page;
  let problems: string[];

  test.beforeAll(async ({ browser }: { browser: Browser }, info) => {
    test.skip(info.project.name !== 'pixel-phone', 'Pixel 8 on Chromium only');
    test.setTimeout(120_000);
    const u = info.project.use;
    context = await browser.newContext({
      viewport: { width: 915, height: 412 },
      screen: { width: 915, height: 412 },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
      ...(u.userAgent ? { userAgent: u.userAgent } : {}),
      baseURL: u.baseURL ?? `http://127.0.0.1:${process.env.TEST_PORT ?? 4173}`,
    });
    // Record what the game asks of the vibration motor (Android's Vibration API).
    await context.addInitScript(() => {
      const log: unknown[] = [];
      (window as unknown as { __vibrations: unknown[] }).__vibrations = log;
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: (p: unknown) => {
          log.push(p);
          return true;
        },
      });
    });
    page = await context.newPage();
    problems = watchProblems(page);
    await page.goto('/?debug=1&quality=lite&world=lite');
    await page.locator('[data-action=press-start]').tap();
    await page.locator('[data-action=mode-timeTrial]').tap();
    await page.locator('[data-action=start]').tap();
    expect(await page.evaluate(() => window.__undercut!.audioStatus())).not.toBe('none');
    await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 90_000 });
  });

  test.afterAll(async () => {
    await page?.evaluate(() => window.__undercut?.quit()).catch(() => undefined);
    await context?.close();
  });

  test('sound runs once the session drives, started from taps alone', async () => {
    const capability = await page.evaluate(() => window.__undercut!.audioCapability());
    const status = (): Promise<string> => page.evaluate(() => window.__undercut!.audioStatus());
    if (capability.supported) await expect.poll(status, { timeout: 15_000 }).toBe('running');
    else await expect.poll(status).toBe('silent');
  });

  test('HUD, touch controls and pause menu keep clear of the side bars', async () => {
    await setInsets(page, INSETS);
    await expect(page.locator('.ut-touch')).toBeVisible();
    // The overlay re-measures on resize; give layout a frame.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(await underBars(page, '[data-testid=hud] *, .ut-touch > *', INSETS)).toEqual([]);
    await page.evaluate(() => window.__undercut!.pause());
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    expect(await underBars(page, '[data-testid=pause-menu] *', INSETS)).toEqual([]);
    await page.evaluate(() => window.__undercut!.resume());
    await setInsets(page, { l: 0, r: 0, t: 0, b: 0 });
  });

  test('upright, the rotate prompt and the pause card keep clear of the top and bottom bars', async () => {
    // Turned upright mid-session: the session pauses and asks for landscape, settings usable.
    await page.setViewportSize({ width: 412, height: 915 });
    await setInsets(page, PORTRAIT_INSETS);
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    // The rotate prompt and the pause card (the HUD under them is laid out for landscape and is
    // not driven upright).
    expect(
      await underBars(
        page,
        '[data-testid=rotate-prompt] *, [data-testid=pause-menu] *',
        PORTRAIT_INSETS,
      ),
    ).toEqual([]);
    await page.setViewportSize({ width: 915, height: 412 });
    await setInsets(page, { l: 0, r: 0, t: 0, b: 0 });
    await page.evaluate(() => window.__undercut!.resume());
    await expect(page.getByTestId('pause-menu')).toBeHidden();
  });

  test('kerbs and button presses vibrate, and the Vibration setting turns it off', async () => {
    const vibrations = (): Promise<unknown[]> =>
      page.evaluate(() =>
        (window as unknown as { __vibrations: unknown[] }).__vibrations.splice(0),
      );
    // A touch on the controls makes touch the active device.
    await page.locator('.ut-touch__btn--gearUp').tap();
    expect(await vibrations()).toContain(8);

    // Onto a kerb at speed: short pulses, a few a second.
    const kerb = await page.evaluate(() => {
      const u = window.__undercut!;
      for (let s = 50; s < 5000; s += 10) {
        const p = u.trackPoint(s);
        if (p.kerbLeft) return { s, d: p.left - 0.3 };
      }
      return null;
    });
    expect(kerb).not.toBeNull();
    const onKerb = async (): Promise<unknown[]> => {
      await vibrations();
      await page.evaluate(({ s, d }) => {
        window.__undercut!.teleport(s, d, 120);
        window.__undercut!.drive({ throttle: 0.6 });
      }, kerb!);
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.__undercut!.drive(null));
      return vibrations();
    };
    const pulses = await onKerb();
    expect(pulses.length).toBeGreaterThan(0);
    for (const ms of pulses) expect(typeof ms === 'number' && ms >= 8 && ms <= 100).toBe(true);

    // Off in the pause menu: nothing, from kerbs or buttons; remembered with the settings.
    await page.evaluate(() => window.__undercut!.pause());
    const row = page.locator('[data-setting=haptics]');
    await row.locator('[data-value="0"]').tap();
    await expect(row.locator('[data-value="0"]')).toHaveAttribute('aria-checked', 'true');
    await page.evaluate(() => window.__undercut!.resume());
    await page.locator('.ut-touch__btn--gearUp').tap();
    expect((await onKerb()).filter((v) => v !== 0)).toEqual([]);
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem('menu.prefs') ?? '{}').settings?.haptics,
    );
    expect(saved).toBe(false);

    // Back on.
    await page.evaluate(() => window.__undercut!.pause());
    await row.locator('[data-value="1"]').tap();
    await page.evaluate(() => window.__undercut!.resume());

    // A browser with no vibration (iPhone Safari) and no pad: the row says so and cannot be set.
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined }),
    );
    await page.evaluate(() => window.__undercut!.pause());
    await expect(row).toBeVisible();
    await expect(row.locator('[data-value="1"]')).toBeDisabled();
    await expect(row.locator('.pause__hint')).toHaveText('Not available on this device');
    await page.evaluate(() => window.__undercut!.resume());
    expect(problems).toEqual([]);
  });
});
