import { expect, test } from '@playwright/test';

const START = '/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy';

test('opening banner, spawn protection, and tribes stay off the leaderboard', async ({ page }) => {
  await page.goto(START);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const banner = page.locator('.banner');
  await expect(banner).toContainText('CHOOSE YOUR STARTING LOCATION');
  await expect(banner).toContainText('Tap any unclaimed land to place your capital');
  const s = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 15_000 });
  await expect(banner).toContainText('THE WAR BEGINS');
  await expect(page.locator('.attacks')).toContainText(/Spawn protection/);
  await expect(page.locator('.leaderboard-row')).toHaveCount(5);
  const tribes = await page.evaluate(() =>
    [...window.__test.state.nations.values()].filter((n) => n.role === 'tribe' && n.tiles > 0).length);
  expect(tribes).toBeGreaterThan(0);
});

test('the box has no water', async ({ page }) => {
  await page.goto('/game/?autostart=1&test=1&map=box&size=small&seed=3&bots=4&difficulty=easy');
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  expect(await page.evaluate(() => window.__test.findWaterTile())).toBeNull();
  expect(await page.evaluate(() => window.__test.state.init.width)).toBe(400);
});

test('defeat reads YOUR NATION HAS FALLEN', async ({ page }) => {
  await page.goto(START);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  await page.evaluate(() => window.__test.forceResult({ winners: [2], reason: 'lastStanding' }));
  await expect(page.locator('.end h1')).toHaveText('YOUR NATION HAS FALLEN');
});

test('the menu offers The Box and Vs Nations', async ({ page }) => {
  await page.goto('/game/?test=1');
  await expect(page.getByRole('radio', { name: 'The Box' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Vs Nations' })).toBeVisible();
});

test('a phone-width banner stays on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(START);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const box = await page.locator('.banner').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
});

test('an atom bomb leaves fallout', async ({ page }) => {
  await page.goto(START);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const s = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 15_000 });
  await page.evaluate(() => window.__test.grant({ gold: 200_000 }));
  const built = await page.evaluate(() => {
    const tile = window.__test.findLandTile('player');
    if (tile === null) return false;
    window.__test.send({ type: 'build', nation: window.__test.state.init.playerId, building: 'missileSilo', tile });
    return true;
  });
  expect(built).toBe(true);
  await page.waitForFunction(
    () => window.__test.state.buildings.some((b) => b.type === 'missileSilo' && !b.underConstruction),
    null,
    { timeout: 20_000 },
  );
  const target = await page.evaluate(() => window.__test.findLandTile('unowned'));
  expect(target).not.toBeNull();
  await page.evaluate((tile) => {
    window.__test.send({ type: 'nuke', nation: window.__test.state.init.playerId, tile: tile!, kind: 'atom' });
  }, target);
  await expect.poll(() => page.evaluate(() => window.__test.state.falloutList.length), { timeout: 20_000 }).toBeGreaterThan(0);
});
