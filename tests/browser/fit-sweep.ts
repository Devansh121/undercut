import type { Page } from '@playwright/test';
import { textFitProblems } from './text-fit';

/**
 * The layout and text-fit sweep, shared by phone-fit.spec (menus) and the session specs (the
 * HUD, the pause card, the Race Weekend screens and their results). One place for the checks and
 * the sizes, so every screen is held to the same rules.
 */

/** The phone sizes: upright iPhone SE / 8, 12-15 and Pro Max; on their side, and Safari with its
 * toolbars showing on a small phone. */
export const PHONES = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 932, height: 430 },
  { width: 568, height: 320 },
];
export const DESKTOP = [{ width: 1440, height: 900 }];
export const TEXT_SIZES = ['standard', 'large', 'larger'] as const;

/** Layout checks for the screen as it stands: in the page, self-contained. */
export function layoutProblems(o: { label: string; targets: boolean }): string[] {
  const { label, targets } = o;
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
  if (root.scrollWidth > w) problems.push(`${label}: page is ${root.scrollWidth}px wide`);
  // The top bar's parts never overlap: wordmark, each breadcrumb, each button on the right.
  const bar = [
    ...document.querySelectorAll<HTMLElement>(
      '.shell__top .wordmark, .shell__top .crumbs > *, .shell__right > *',
    ),
  ].filter((el) => el.getClientRects().length > 0 && !el.closest('[hidden]'));
  const barName = (el: HTMLElement): string =>
    el.getAttribute('aria-label') ?? (el.textContent?.trim() || el.className);
  bar.forEach((a, i) => {
    const ra = a.getBoundingClientRect();
    for (const b of bar.slice(i + 1)) {
      const rb = b.getBoundingClientRect();
      const apart =
        ra.right <= rb.left + 0.5 ||
        rb.right <= ra.left + 0.5 ||
        ra.bottom <= rb.top ||
        rb.bottom <= ra.top;
      if (!apart) problems.push(`${label}: top bar ${barName(a)} overlaps ${barName(b)}`);
    }
  });
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
      targets &&
      (el.matches('button, input, a, [data-nav]') || el.getAttribute('role') === 'slider') &&
      (r.width < 43.5 || r.height < 43.5)
    )
      problems.push(`${name} is a ${Math.round(r.width)} x ${Math.round(r.height)} target`);
  }
  return problems;
}

/** Set the text size as Settings does (standard: no attribute). */
export function setTextSize(page: Page, text: string): Promise<void> {
  return page.evaluate((t) => {
    if (t === 'standard') delete document.documentElement.dataset.text;
    else document.documentElement.dataset.text = t;
  }, text);
}

/**
 * The screen as it stands, at each size and text size: layout (viewport, top bar, clipping, and on
 * phones 44 px targets) and every piece of text inside its box. Restores the viewport and the
 * standard text size. In a session, turning a phone upright pauses it behind the rotate prompt
 * (phone-session.ts); on the way back to landscape the pause is lifted, as a player would.
 */
export async function fitEverywhere(
  page: Page,
  o: { label: string; sizes: readonly { width: number; height: number }[]; scope?: string },
): Promise<string[]> {
  const before = page.viewportSize();
  const problems: string[] = [];
  try {
    for (const size of o.sizes) {
      await page.setViewportSize(size);
      const phone = size.width < 1000;
      for (const text of TEXT_SIZES) {
        await setTextSize(page, text);
        const label = `${o.label}, ${size.width} x ${size.height}, ${text} text`;
        problems.push(...(await page.evaluate(layoutProblems, { label, targets: phone })));
        for (const p of await page.evaluate(textFitProblems, o.scope ?? '#app'))
          problems.push(`${label}: ${p}`);
      }
    }
  } finally {
    await setTextSize(page, 'standard');
    if (before) await page.setViewportSize(before);
    await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>('[data-testid=pause-menu]');
      if (menu && !menu.hidden && innerWidth > innerHeight) window.__undercut?.resume();
    });
  }
  return problems;
}
