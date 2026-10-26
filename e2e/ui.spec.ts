import { expect, test } from '@playwright/test';

const GAME = '/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy';

test('every build button shows its icon, and panels share the rounded glass style', async ({ page }) => {
  await page.goto(GAME);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  await expect(page.locator('.hud button.build canvas.build-icon')).toHaveCount(13);
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

test('a new news line slides in without the older lines appearing again', async ({ page }) => {
  await page.goto(GAME);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const cities = page.locator('.feed-line', { hasText: 'City complete' });
  // the feed redraws with the next update from the game
  const add = async (tile: number, shown: number): Promise<void> => {
    await page.evaluate((t) => {
      const s = window.__test.state;
      s.feed.push({ type: 'buildingDone', nation: s.init.playerId, building: 'city', tile: t });
    }, tile);
    await expect(cities).toHaveCount(shown);
  };
  await add(1, 1);
  await cities.last().evaluate((el) => el.setAttribute('data-first', ''));
  await add(2, 2);
  // the first line is still the same element, so its slide-in does not play again; only the new line slides in
  await expect(page.locator('.feed-line[data-first]')).toHaveCount(1);
  expect(await page.locator('.feed-line').last().getAttribute('data-first')).toBeNull();
});

async function playing(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(GAME);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const s = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 20_000 });
  await page.keyboard.press('Space');
}

test('the victory screen pops in with confetti and counts the stats up', async ({ page }) => {
  await playing(page);
  await page.evaluate(() => window.__test.forceResult({ winners: [window.__test.state.init.playerId], reason: 'landShare' }));
  await expect(page.locator('.end-card.pop')).toBeVisible();
  await expect(page.locator('.end-card h1')).toHaveClass(/shine/);
  await expect(page.locator('.confetti i')).toHaveCount(90);
  // the game is paused, so the time played stays put while it counts up to it
  const final = await page.evaluate(() => {
    const s = Math.floor(window.__test.state.tick / 10);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  expect(final).not.toBe('0:00');
  await expect(page.locator('.end-stat', { hasText: 'Time played' }).locator('.end-stat-value')).toHaveText(final);
  await page.screenshot({ path: 'test-results/victory.png' });
});

test('the defeat screen drops in and greys the map', async ({ page }) => {
  await playing(page);
  expect(await page.evaluate(() => window.__test.grey())).toBe(0);
  await page.evaluate(() => window.__test.forceResult({ winners: [2], reason: 'landShare' }));
  await expect(page.locator('.end-card.drop')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__test.grey()), { timeout: 2500 }).toBe(1);
  await page.screenshot({ path: 'test-results/defeat.png' });
});
