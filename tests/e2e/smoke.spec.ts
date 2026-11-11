import { expect, test, type Page } from '@playwright/test';

// Fails on any console error / page error. Screenshots go to test-results/screens/.
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function ready(page: Page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => window.__modulo?.ready === true, undefined, { timeout: 30_000 });
  // The sandbox renders in software; keep the watchdog from changing presets mid-test.
  await page.evaluate(() => {
    const g = window.__modulo!.game as unknown as { settings: { watchdog: boolean } };
    g.settings.watchdog = false;
  });
}

test('first visit shows the main menu, then the sandbox', async ({ page }, info) => {
  const errors = watchErrors(page);
  await ready(page);
  const menu = page.getByRole('dialog', { name: 'Modulo: Ragdoll' });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: `test-results/screens/${info.project.name}-menu.png` });
  await menu.getByRole('button', { name: /Play/ }).click();
  await expect(menu).toBeHidden();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `test-results/screens/${info.project.name}-sandbox.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('casting powers with the pointer works without errors', async ({ page }, info) => {
  const errors = watchErrors(page);
  await ready(page, '/?nomenu');
  const box = page.viewportSize()!;
  // Lightning → chain lightning on the dummies.
  await page.getByRole('button', { name: /Lightning/ }).first().click();
  await page.getByRole('button', { name: /Bolt strike/ }).click();
  await page.mouse.click(box.width * 0.45, box.height * 0.55);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test-results/screens/${info.project.name}-strike.png` });
  // Fire → fireball (drag-aim).
  await page.getByRole('button', { name: /Fire/ }).first().click();
  await page.getByRole('button', { name: /Fireball/ }).click();
  await page.mouse.move(box.width * 0.2, box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.width * 0.3, box.height * 0.35, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `test-results/screens/${info.project.name}-fireball.png` });
  const chaos = await page.evaluate(() => (window.__modulo!.game as unknown as { runtime: { chaosScore: number } }).runtime.chaosScore);
  expect(chaos).toBeGreaterThan(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('settings: Battery Saver persists; power browser and credits render', async ({ page }, info) => {
  const errors = watchErrors(page);
  await ready(page, '/?nomenu');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Settings/ }).click();
  await page.getByRole('radio', { name: 'Battery Saver' }).click();
  await page.screenshot({ path: `test-results/screens/${info.project.name}-settings.png` });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('modulo-ragdoll:settings:v1') ?? '{}').preset);
  expect(stored).toBe('battery');
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: /Power browser/ }).click();
  await expect(page.getByRole('dialog', { name: 'Power browser' })).toContainText('Spirit Beam');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/screens/${info.project.name}-powers.png` });
  await page.getByRole('button', { name: '← Back' }).click();
  await page.getByRole('button', { name: /Credits/ }).click();
  const credits = page.getByRole('dialog', { name: 'Credits' });
  await expect(credits).toContainText('Lorc');
  await expect(credits).toContainText('CC0');
  await page.screenshot({ path: `test-results/screens/${info.project.name}-credits.png` });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('save to a slot and load it back', async ({ page }) => {
  const errors = watchErrors(page);
  await ready(page, '/?nomenu');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /Save & load/ }).click();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Save & load' })).toContainText('2 dummies');
  await page.getByRole('button', { name: 'Load' }).first().click();
  const dummies = await page.evaluate(() => (window.__modulo!.game as unknown as { world: { dummies: Map<number, unknown> } }).world.dummies.size);
  expect(dummies).toBe(2);
  expect(errors, errors.join('\n')).toEqual([]);
});
