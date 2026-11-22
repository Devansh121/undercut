import { expect, type Page } from '@playwright/test';

/** Collect console errors, warnings and page errors for the whole test. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/**
 * Wait until the 3D view has drawn `n` more frames, so the canvas shows a state set before the
 * call. Animation frames are not enough: while the GPU is two frames behind, a frame skips its
 * draw (FramePacer in packages/render), and on software WebGL that is the usual case.
 */
export async function waitForDraws(page: Page, n = 2): Promise<void> {
  const drawn = (): Promise<number> =>
    page.evaluate(() => window.__undercut?.renderStats().drawnFrames as number);
  const from = await drawn();
  await page.waitForFunction(
    ({ from, n }) => {
      const now = window.__undercut?.renderStats().drawnFrames as number;
      // A new view (quality switch, context restore) counts from zero.
      return now >= from + n || (now < from && now >= n);
    },
    { from, n },
  );
}

/** From the launch screen to the main menu, with a real click on the prompt. */
export async function openMenu(page: Page): Promise<void> {
  await page.locator('[data-action=press-start]').click();
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
}

/**
 * From the launch screen through the main menu into a time-trial session (real clicks; the
 * Start press is the audio gesture). Waits for the loading to begin, not for the session.
 */
export async function startTimeTrial(page: Page): Promise<void> {
  await openMenu(page);
  await page.locator('[data-action=mode-timeTrial]').click();
  await page.locator('[data-action=start]').click();
}

/**
 * From the launch screen through the main menu into a Quick Race at Monza (real clicks). Waits
 * for the loading to begin, not for the session.
 */
export async function startQuickRace(page: Page): Promise<void> {
  await openMenu(page);
  await page.locator('[data-action=mode-quickRace]').click();
  await page.locator('[data-action=start]').click();
}

/**
 * Load the launch screen with the debug API and start Time Trial with real clicks, without the
 * circuit's surroundings (`world=lite`): the full world is tested once, in world-dressing.spec.ts,
 * and its start-up cost on the GPU (`npm run shots -- monza --perf`).
 */
export async function coldStart(page: Page, quality: 'lite' | 'mobile'): Promise<void> {
  await page.goto(`/?debug=1&quality=${quality}&world=lite`);
  await startTimeTrial(page);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await expect(page.locator('[data-testid=hud]')).toBeVisible();
}

/** Colour count and brightness spread of the 3D view with the HUD hidden: a black or flat view fails. */
export async function viewPixels(
  page: Page,
  rows: { from: number; to: number } = { from: 0, to: 1 },
): Promise<{ colours: number; lumaStdDev: number; meanLuma: number }> {
  const style = '#app, .ut-touch { visibility: hidden; }';
  let png: Buffer;
  let clipped = false;
  if (rows.from > 0 || rows.to < 1) {
    const box = await page.locator('#view').boundingBox();
    if (!box) throw new Error('no #view bounding box');
    const y0 = Math.floor(box.height * rows.from);
    const y1 = Math.max(y0 + 1, Math.floor(box.height * rows.to));
    png = await page.screenshot({
      clip: { x: box.x, y: box.y + y0, width: box.width, height: y1 - y0 },
      style,
    });
    clipped = true;
  } else {
    png = await page.locator('#view').screenshot({ style });
  }
  return page.evaluate(
    async ({ b64, from, to, clipped }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const y0 = clipped ? 0 : Math.floor(img.height * from);
      const y1 = clipped ? img.height : Math.max(y0 + 1, Math.floor(img.height * to));
      const { data } = ctx.getImageData(0, y0, img.width, y1 - y0);
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
      return {
        colours: colours.size,
        lumaStdDev: Math.sqrt(sumSq / n - mean * mean),
        meanLuma: mean,
      };
    },
    { b64: png.toString('base64'), from: rows.from, to: rows.to, clipped },
  );
}
