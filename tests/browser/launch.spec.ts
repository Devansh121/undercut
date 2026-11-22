import type { Page } from '@playwright/test';
import { expect, test } from './base';
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
  test('renders the name, the start prompt and the build, and opens the main menu', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto('/');

    await expect(page).toHaveTitle(GAME_NAME);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(GAME_NAME);
    const press = page.locator('[data-action=press-start]');
    await expect(press).toContainText(/press any key or tap to start/i);
    await expect(page.locator('.launch__build code')).toHaveText(
      /^([0-9a-f]{7}(\+dirty)?|unversioned)$/,
    );
    // The map data's licence asks for a credit where the game is seen.
    await expect(page.getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
    // No debug API without ?debug=1 in a production build.
    expect(await page.evaluate(() => typeof window.__undercut !== 'undefined')).toBe(false);
    await press.click();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'hub');
    await expect(page.getByRole('button', { name: /Start session/ })).toBeEnabled();
    expect(errors).toEqual([]);
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
