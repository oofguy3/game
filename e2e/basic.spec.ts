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

test('one game speed: a single pause button, and Space toggles it', async ({ page }) => {
  await page.goto('/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy');
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const bar = page.locator('.pause');
  await expect(bar.getByRole('button')).toHaveCount(1);
  const button = bar.getByRole('button');
  await expect(button).toHaveAccessibleName('Pause (Space)');
  await button.click();
  await expect(button).toHaveAccessibleName('Resume (Space)');
  const paused = await page.evaluate(() => window.__test.state.tick);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__test.state.tick)).toBe(paused);
  await page.keyboard.press('Space');
  await expect(button).toHaveAccessibleName('Pause (Space)');
  await expect.poll(() => page.evaluate(() => window.__test.state.tick), { timeout: 5_000 }).toBeGreaterThan(paused);
});

test('placing mode ends by itself when the building is no longer affordable', async ({ page }) => {
  await page.goto('/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy');
  await page.waitForFunction(() => [...(window.__test?.state.nations.values() ?? [])].filter((n) => n.spawned).length >= 4);
  const s = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 15_000 });
  await page.evaluate(() => window.__test.grant({ gold: 5000 }));
  await expect(page.locator('button[data-building="city"]')).toBeEnabled();
  await page.keyboard.press('1');
  const banner = page.locator('.banner');
  await expect(banner).toHaveText(/place it/);
  // the gold is gone before a spot is picked
  await page.evaluate(() => window.__test.grant({ gold: -window.__test.state.player!.gold }));
  await expect(page.locator('button[data-building="city"]')).toBeDisabled();
  await expect(banner).toBeHidden();
  await expect(page.locator('canvas.map')).not.toHaveClass(/placing/);
});
