import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Refreshes the pictures in docs/screenshots. Runs only when asked: SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
const OUT = 'docs/screenshots';
test.skip(!process.env.SCREENSHOTS, 'only when SCREENSHOTS=1');

const clickTile = async (page: Page, tile: number, button: 'left' | 'right' = 'left'): Promise<void> => {
  const s = await page.evaluate((t) => window.__test.tileToScreen(t), tile);
  await page.mouse.click(s.x, s.y, { button });
};
const find = (page: Page, kind: Parameters<typeof window.__test.findLandTile>[0]): Promise<number> =>
  page.evaluate((k) => window.__test.findLandTile(k)!, kind);

test('title screen', async ({ page }) => {
  await page.goto('/game/?test=1&look=gl');
  await expect(page.locator('canvas.backdrop')).toHaveCount(1);
  await page.waitForTimeout(3000); // the world map loads behind the menu
  await page.screenshot({ path: `${OUT}/1-menu.png` });
});

test('the world map at the start', async ({ page }) => {
  await page.goto('/game/?autostart=1&test=1&look=gl&map=world&bots=16&difficulty=normal&seed=3');
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  await page.waitForFunction(() => [...window.__test.state.nations.values()].filter((n) => n.spawned).length >= 16);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/2-spawn.png` });
});

test('a game in progress: territories, buildings, the right-click menu and diplomacy, and a close-up', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/game/?autostart=1&test=1&look=gl&map=random&size=small&seed=11&bots=6&difficulty=easy');
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  await page.waitForFunction(() => [...window.__test.state.nations.values()].filter((n) => n.spawned).length >= 6);
  await clickTile(page, await find(page, 'coastal-unowned'));
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 30_000 });
  await page.evaluate(() => window.__test.grant({ gold: 1_000_000, troops: 60_000 }));
  for (let i = 0; i < 6; i++) {
    await clickTile(page, await find(page, 'unowned'));
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(8000);
  for (const [key, kind] of [['1', 'player-interior'], ['7', 'player-coastal'], ['9', 'player-interior'], ['2', 'player-interior']] as const) {
    await page.keyboard.press(key);
    await clickTile(page, await find(page, kind));
  }
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/3-midgame.png` });

  await clickTile(page, await find(page, 'enemy'), 'right');
  await page.locator('.context-menu').getByRole('button', { name: /^Diplomacy with/ }).click();
  await clickTile(page, await find(page, 'player-interior'), 'right');
  await page.locator('.context-menu').getByRole('button', { name: /^Build/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/4-diplomacy.png` });
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 400);

  const border = await page.evaluate(() => {
    const s = window.__test.state;
    const w = s.init.width;
    for (let t = 0; t < s.owner.length; t++) {
      if (s.owner[t] !== s.init.playerId) continue;
      for (const m of [t - 1, t + 1, t - w, t + w]) if (m >= 0 && m < s.owner.length && s.owner[m] !== s.owner[t] && s.owner[m] !== 0) return t;
    }
    return window.__test.findLandTile('player')!;
  });
  await page.evaluate((t) => window.__test.zoomTo(9, t), border);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/6-closeup.png` });
});

test('victory', async ({ page }) => {
  await page.goto('/game/?autostart=1&test=1&look=gl&map=random&size=small&seed=7&bots=4&difficulty=easy');
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  await clickTile(page, await find(page, 'unowned'));
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 20_000 });
  await page.evaluate(() => window.__test.grant({ troops: 50_000 }));
  for (let i = 0; i < 3; i++) {
    await clickTile(page, await find(page, 'unowned'));
    await page.waitForTimeout(1500);
  }
  await page.keyboard.press('Space');
  await page.evaluate(() => window.__test.forceResult({ winners: [window.__test.state.init.playerId], reason: 'landShare' }));
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${OUT}/5-end.png` });
});
