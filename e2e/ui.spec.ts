import { expect, test } from '@playwright/test';

const GAME = '/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy';

test('every build button shows its icon, and panels share the rounded glass style', async ({ page }) => {
  await page.goto(GAME);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  await expect(page.locator('.hud button.build canvas.build-icon')).toHaveCount(11);
  for (const sel of ['.hud', '.leaderboard', '.pause']) {
    expect(await page.locator(sel).evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px');
  }
});

test('the right-click menu slides in when it opens', async ({ page }) => {
  await page.goto(GAME);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const s = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 20_000 });
  const t = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('player')!));
  await page.mouse.click(t.x, t.y, { button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.context-menu')).toHaveClass(/\benter\b/);
});
