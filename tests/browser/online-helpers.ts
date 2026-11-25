import type { Browser, Page } from '@playwright/test';
import { expect } from './base';
import { openMenu } from './helpers';

export const onlineState = (page: Page) => page.evaluate(() => window.__undercut!.online());

export async function onlinePair(browser: Browser, baseURL: string, netSim = '') {
  const contexts = await Promise.all(
    [0, 1].map(() => browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })),
  );
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()));
  const suffix = '&debug=1&quality=lite' + netSim;
  await host!.goto('/?' + suffix.slice(1));
  await openMenu(host!);
  await host!.locator('[data-action=mode-online]').click();
  await host!.locator('[data-action=start]').click();
  await host!.getByLabel('Driver name').fill('Host');
  await host!.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(host!.getByTestId('invite')).toBeVisible();
  await guest!.goto((await host!.getByTestId('invite').getAttribute('href'))! + suffix);
  await guest!.getByLabel('Driver name').fill('Guest');
  await guest!.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect.poll(async () => (await onlineState(host!)).state?.members.length).toBe(2);
  return {
    host: host!,
    guest: guest!,
    close: async () => {
      for (const page of [host!, guest!]) await page.goto('about:blank').catch(() => undefined);
      for (const context of contexts) await context.close();
    },
  };
}

export async function onlineStart(host: Page, guest: Page) {
  await guest.getByRole('button', { name: 'Ready', exact: true }).click();
  await host.getByRole('button', { name: 'Ready to start', exact: true }).click();
  for (const page of [host, guest])
    await expect
      .poll(async () => (await onlineState(page)).race?.released, { timeout: 90000 })
      .toBe(true);
}
