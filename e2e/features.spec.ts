import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { FindKind } from '../src/client/testApi';

/** Centres the view on a tile of `kind` and clicks it with `button`; returns the tile. */
async function clickTile(page: Page, kind: FindKind, button: 'left' | 'right' = 'left'): Promise<number> {
  const found = await page.evaluate((k) => {
    const tile = window.__test.findLandTile(k);
    return tile === null ? null : { tile, at: window.__test.centerOn(tile) };
  }, kind);
  expect(found, `a ${kind} tile`).not.toBeNull();
  await page.mouse.click(found!.at.x, found!.at.y, { button });
  return found!.tile;
}

const units = (page: Page, type: string) =>
  page.evaluate((t) => window.__test.state.units.filter((u) => u.owner === window.__test.state.init.playerId && u.type === t).length, type);

const activeBuildings = (page: Page, type: string) =>
  page.evaluate((t) => window.__test.state.buildings.filter((b) => b.owner === window.__test.state.init.playerId
    && b.type === t && !b.underConstruction).length, type);

test('build, boat, bomber, alliance', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/game/?autostart=1&test=1&map=random&size=small&seed=11&bots=4&difficulty=easy');
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  // pick a start only once the bots have theirs, so it can't land too close to one
  await page.waitForFunction(() => [...window.__test.state.nations.values()].filter((n) => n.spawned).length >= 4);
  await clickTile(page, 'coastal-unowned');
  await page.waitForFunction(() => window.__test.state.player?.spawned === true);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__test.findLandTile('player-coastal'))).not.toBeNull();
  await page.evaluate(() => window.__test.grant({ gold: 1_000_000, troops: 15_000 }));

  // grow a little first, so there is room for three buildings
  for (let i = 0; i < 3; i++) {
    await clickTile(page, 'unowned');
    await page.waitForTimeout(1500);
  }
  await expect.poll(() => page.evaluate(() => window.__test.state.player!.tiles), { timeout: 15_000 }).toBeGreaterThan(250);

  await page.keyboard.press('1');
  await clickTile(page, 'player-interior');
  await expect.poll(() => page.evaluate(() => window.__test.state.buildings.filter((b) => b.type === 'city'
    && b.owner === window.__test.state.init.playerId).length), { timeout: 10_000 }).toBe(1);
  await page.keyboard.press('7');
  await clickTile(page, 'player-coastal');
  await page.keyboard.press('9');
  await clickTile(page, 'player-interior');
  await expect.poll(() => activeBuildings(page, 'port'), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => activeBuildings(page, 'airport'), { timeout: 20_000 }).toBe(1);

  // bomb an enemy from the right-click menu, once one is in range and the opening shield is down
  await expect.poll(() => page.evaluate(() => {
    const tile = window.__test.findLandTile('bomb-target');
    if (tile === null) return false;
    const owner = window.__test.state.owner[tile];
    return window.__test.state.nations.get(owner)?.shielded !== true;
  }), { timeout: 80_000 }).toBe(true);
  await clickTile(page, 'bomb-target', 'right');
  const menu = page.locator('.context-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Bomb' }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => units(page, 'bomber'), { timeout: 5_000 }).toBe(1);

  // send a boat overseas
  await clickTile(page, 'overseas-enemy', 'right');
  await menu.getByRole('button', { name: 'Send boat' }).click();
  await expect.poll(() => units(page, 'troopBoat'), { timeout: 5_000 }).toBeGreaterThan(0);

  // offer an alliance from the diplomacy panel
  await clickTile(page, 'enemy', 'right');
  await menu.getByRole('button', { name: /^Diplomacy with/ }).click();
  const panel = page.locator('.diplomacy');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Propose alliance' }).click();
  await expect.poll(() => page.evaluate(() => window.__test.state.feed.some((e) => e.type === 'requestResolved'
    && e.kind === 'alliance' && e.from === window.__test.state.init.playerId)), { timeout: 5_000 }).toBe(true);

  await page.screenshot({ path: 'test-results/features.png' });
  expect(errors).toEqual([]);
});
