import { expect, test, type Page } from '@playwright/test';
import { GAME_NAME } from '@undercut/core';
import { PROTOCOL_VERSION } from '@undercut/protocol';

/** Collect console errors and uncaught exceptions for the whole test. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()}`));
  return errors;
}

test.describe('launch screen', () => {
  test('renders the name, a disabled Drive button and the build', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');

    await expect(page).toHaveTitle(GAME_NAME);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(GAME_NAME);
    const drive = page.getByRole('button', { name: 'Drive' });
    await expect(drive).toBeDisabled();
    await expect(drive).toContainText('Arrives in M1');
    await expect(page.locator('.launch__build code')).toHaveText(
      /^([0-9a-f]{7}(\+dirty)?|unversioned)$/,
    );

    expect(errors).toEqual([]);
  });

  test('draws a non-empty 3D view', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveAttribute('data-webgl', 'unavailable');

    const viewport = page.viewportSize();
    const box = await page.locator('#view').boundingBox();
    expect(box?.width).toBe(viewport?.width);
    expect(box?.height).toBe(viewport?.height);

    // Hide the menu so the capture is the canvas alone, then let a few frames render.
    await page.addStyleTag({ content: '#app { visibility: hidden; }' });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const png = await page.locator('#view').screenshot();

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

    // A blank or single-colour canvas has one colour and zero spread.
    expect(stats.colours).toBeGreaterThan(16);
    expect(stats.lumaStdDev).toBeGreaterThan(5);
    expect(errors).toEqual([]);
  });

  test('fits the viewport with nothing clipped or overflowing', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const report = await page.evaluate(() => {
      const problems: string[] = [];
      const { innerWidth: w, innerHeight: h } = window;
      const root = document.documentElement;
      if (root.scrollWidth > w)
        problems.push(`page is ${root.scrollWidth}px wide in a ${w}px viewport`);
      if (root.scrollHeight > h)
        problems.push(`page is ${root.scrollHeight}px tall in a ${h}px viewport`);
      for (const el of document.querySelectorAll<HTMLElement>('#app *')) {
        const r = el.getBoundingClientRect();
        const name = `${el.tagName.toLowerCase()}.${el.className}`;
        if (r.left < 0 || r.top < 0 || r.right > w + 0.5 || r.bottom > h + 0.5) {
          problems.push(
            `${name} at ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} leaves the viewport`,
          );
        }
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') {
          problems.push(`${name} clips its content horizontally`);
        }
      }
      return problems;
    });
    expect(report).toEqual([]);
  });
});

test.describe('serving', () => {
  test('reaches the rooms service through same-origin /rooms over a WebSocket', async ({
    page,
  }) => {
    await page.goto('/');
    const welcome = await page.evaluate(async (v) => {
      const created = await fetch('/rooms', { method: 'POST' });
      const { code } = (await created.json()) as { code: string };
      const url = new URL(`/rooms/${code}/ws`, location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(url);
      return await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no welcome within 5 s')), 5000);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'join', v, name: 'Smoke' }));
        ws.onmessage = (event) => {
          const message = JSON.parse(String(event.data)) as { type: string };
          if (message.type !== 'welcome') return;
          clearTimeout(timer);
          ws.close();
          resolve(message);
        };
        ws.onerror = () => reject(new Error('socket error'));
      });
    }, PROTOCOL_VERSION);
    expect(welcome).toMatchObject({
      type: 'welcome',
      seat: 0,
      room: { phase: 'lobby', members: [{ name: 'Smoke' }] },
    });
  });

  test('serves the same client over HTTPS', async ({ playwright }, testInfo) => {
    const httpsPort = testInfo.config.metadata.httpsPort as number;
    const context = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    const res = await context.get(`https://127.0.0.1:${httpsPort}/`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(`<title>${GAME_NAME}</title>`);
    const health = await context.get(`https://127.0.0.1:${httpsPort}/rooms/health`);
    expect(await health.json()).toMatchObject({ ok: true });
    await context.dispose();
  });
});
