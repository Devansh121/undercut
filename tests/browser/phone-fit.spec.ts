import type { Page } from '@playwright/test';
import { expect, test } from './base';
import { openMenu, watchProblems } from './helpers';

/**
 * Every menu screen at phone sizes, upright and on its side, on Chromium (`phone`) and WebKit
 * (`webkit-phone`, the engine behind every iPhone browser). Nothing may run past the sides of the
 * viewport: no horizontal page scroll, no element (text included) past the left or right edge,
 * nothing clipped sideways. Vertically, a screen may scroll inside its own scroll box, but
 * nothing may hang off the bottom of the page. Every control is a 44 px touch target. DOM only.
 */
const SIZES = [
  // Portrait: iPhone SE / 8, iPhone 12-15, the large Pro Max size.
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  // Landscape, and Safari with its toolbars showing on a small phone.
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
  { width: 568, height: 320 },
];

interface Step {
  label: string;
  click?: string;
}

function sweep(page: Page, steps: readonly Step[]): Promise<string[]> {
  return page.evaluate((list) => {
    const problems: string[] = [];
    const { innerWidth: w, innerHeight: h } = window;
    const root = document.documentElement;
    const scrollBox = (el: Element): Element | null => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const y = getComputedStyle(p).overflowY;
        if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p;
      }
      return null;
    };
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
        if (el.closest('.tip')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const name = `${label}: ${el.tagName.toLowerCase()}.${String(el.className)}`;
        const sideways = r.left < -0.5 || r.right > w + 0.5;
        // Below the fold is fine inside a scroll box (it scrolls into view), never on the page.
        const offPage = !scrollBox(el) && (r.top < -0.5 || r.bottom > h + 0.5);
        if (sideways || offPage)
          problems.push(
            `${name} leaves the viewport (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`,
          );
        if (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible')
          problems.push(`${name} clips its content sideways`);
        if (
          el.scrollHeight > el.clientHeight + 1 &&
          style.overflowY !== 'visible' &&
          style.overflowY !== 'auto'
        )
          problems.push(`${name} clips its content`);
        if (
          (el.matches('button, input, a, [data-nav]') || el.getAttribute('role') === 'slider') &&
          (r.width < 43.5 || r.height < 43.5)
        )
          problems.push(`${name} is a ${Math.round(r.width)} x ${Math.round(r.height)} target`);
      }
    }
    return problems;
  }, steps);
}

for (const size of SIZES) {
  const shape = size.width < size.height ? 'portrait' : 'landscape';
  test(`menus fit a ${size.width} x ${size.height} phone (${shape})`, async ({ page }, info) => {
    test.skip(!/phone/.test(info.project.name), 'phone projects only');
    const problems = watchProblems(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('[data-action=press-start]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await sweep(page, [{ label: 'launch' }])).toEqual([]);
    await openMenu(page);
    expect(
      await sweep(page, [
        ...['timeTrial', 'quickRace', 'weekend', 'championship', 'online', 'timeTrial'].map(
          (m) => ({ label: `main menu, ${m}`, click: `[data-action=mode-${m}]` }),
        ),
        { label: 'main menu, another team', click: '[data-action=team-next]' },
        { label: 'settings', click: '[data-action=edit-settings]' },
        {
          label: 'settings closed',
          click: '[data-testid=settings-dialog] [data-action=dialog-close]',
        },
        { label: 'controls', click: '.shell__top [data-action=controls]' },
        { label: 'controls closed', click: '[data-action=close-controls]' },
        { label: 'circuit select', click: '[data-action=change-circuit]' },
        { label: 'main menu at spa', click: '.ccard[data-circuit=spa]' },
      ]),
    ).toEqual([]);
    await page.locator('[data-action=mode-online]').click();
    await page.locator('[data-action=start]').click();
    await expect(page.locator('.online-screen')).toBeVisible();
    expect(await sweep(page, [{ label: 'online rooms' }])).toEqual([]);
    // One room per shape on the smallest sizes: the room service limits creations per address.
    if (size.width === 375 || size.width === 568) {
      await page.locator('#online-create-room').click();
      await expect(page.getByTestId('invite')).toBeVisible();
      expect(await sweep(page, [{ label: 'room lobby' }])).toEqual([]);
    }
    expect(problems).toEqual([]);
  });
}
