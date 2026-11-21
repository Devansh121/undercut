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
export async function coldStart(page: Page, quality: 'lite' | 'mobile'): Promise<void> {
  await page.goto(`/?debug=1&quality=${quality}`);
  await page.getByRole('button', { name: /Start/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
  await expect(page.locator('[data-testid=hud]')).toBeVisible();
}
