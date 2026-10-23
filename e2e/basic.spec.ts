import { expect, test } from '@playwright/test';

test('start, spawn, expand, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy');
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const s = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 15_000 });
  const before = await page.evaluate(() => window.__test.state.player!.tiles);
  expect(before).toBeGreaterThan(0);
  const t = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(t.x, t.y);
  await expect.poll(() => page.evaluate(() => window.__test.state.player!.tiles), { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(page.locator('.leaderboard-row')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/basic.png' });
  expect(errors).toEqual([]);
});

test('menu starts a game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/game/?test=1');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.screenshot({ path: 'test-results/menu.png' });
  await page.getByLabel('Map').selectOption('random');
  await page.getByLabel('Bots').fill('6');
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  await expect(page.locator('.hud')).toBeVisible();
  expect(errors).toEqual([]);
});
