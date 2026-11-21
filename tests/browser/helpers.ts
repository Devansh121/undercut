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

/** Load the launch screen with the debug API and press Start with a real click. */
/**
 * Launch to a driving session. The circuit's surroundings are Lite's subset (`world=lite`): the
 * full world is tested once, in world-dressing.spec.ts, and its start-up cost on the GPU
 * (`npm run shots -- monza --perf`).
 */
export async function coldStart(page: Page, quality: 'lite' | 'mobile'): Promise<void> {
  await page.goto(`/?debug=1&quality=${quality}&world=lite`);
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await expect(page.locator('[data-testid=hud]')).toBeVisible();
}

/** Colour count and brightness spread of the 3D view with the HUD hidden: a black or flat view fails. */
export async function viewPixels(
  page: Page,
  rows: { from: number; to: number } = { from: 0, to: 1 },
): Promise<{ colours: number; lumaStdDev: number; meanLuma: number }> {
  const png = await page
    .locator('#view')
    .screenshot({ style: '#app, .ut-touch { visibility: hidden; }' });
  return page.evaluate(
    async ({ b64, from, to }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const y0 = Math.floor(img.height * from);
      const y1 = Math.max(y0 + 1, Math.floor(img.height * to));
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
    { b64: png.toString('base64'), from: rows.from, to: rows.to },
  );
}
