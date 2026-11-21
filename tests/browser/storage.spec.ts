import { expect, test } from '@playwright/test';
import { coldStart, watchProblems } from './helpers';

// A fresh page: storage has to be blocked before the game loads.
test('says records last only until the page closes when storage is blocked', async ({ page }) => {
  const problems = watchProblems(page);
  // Private-mode style blocking: touching localStorage throws.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await coldStart(page, 'lite');
  await expect(page.locator('[data-testid=hud-message]')).toContainText(
    'Records last until the page closes',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid=pause-menu]')).toContainText(
    'Records last until the page closes',
  );
  expect(problems).toEqual([]);
});
