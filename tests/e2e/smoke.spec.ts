import { expect, test } from '@playwright/test';

// Boots the app, fails on any console error or page error, and stores screenshots.
test('boots without console errors and shows credits', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.waitForFunction(() => window.__modulo?.ready === true, undefined, { timeout: 20_000 });
  await page.waitForTimeout(1500); // let bodies settle
  await expect(page.locator('#status')).toContainText('Rapier');
  await page.screenshot({ path: `test-results/screens/${info.project.name}-boot.png` });

  // Tap to push bodies + spark burst, capture a short frame sequence.
  const box = page.viewportSize()!;
  await page.mouse.click(box.width / 2, box.height * 0.7);
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(80);
    await page.screenshot({ path: `test-results/screens/${info.project.name}-burst-${i}.png` });
  }

  await page.getByRole('button', { name: 'Credits' }).click();
  const credits = page.getByRole('dialog', { name: 'Credits' });
  await expect(credits).toBeVisible();
  await expect(credits).toContainText('CC0');
  await expect(credits).toContainText('Lorc');
  await page.screenshot({ path: `test-results/screens/${info.project.name}-credits.png` });

  expect(errors, errors.join('\n')).toEqual([]);
});
