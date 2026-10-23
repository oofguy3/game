import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const GAME = '/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy';

/** Starts a small game, spawns the player (the first click, which unlocks sound) and waits for the war. */
async function spawned(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(GAME);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const s = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 20_000 });
  return errors;
}

async function attackFreeLand(page: Page): Promise<void> {
  const t = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(t.x, t.y);
}

test('sound is on at half volume and running after the first click; sending troops whooshes', async ({ page }) => {
  const errors = await spawned(page);
  await expect.poll(() => page.evaluate(() => window.__test.sound().state)).toBe('running');
  const sound = await page.evaluate(() => window.__test.sound());
  expect(sound.muted).toBe(false);
  expect(sound.volume).toBe(0.5);
  await page.waitForTimeout(1000); // the sounds load in the background
  await attackFreeLand(page);
  await expect.poll(() => page.evaluate(() => window.__test.sound().played), { timeout: 5000 }).toContain('send');
  expect(errors).toEqual([]);
});

test('mute and volume are remembered after a reload', async ({ page }) => {
  const errors = await spawned(page);
  await page.getByLabel('Volume').evaluate((el: HTMLInputElement) => {
    el.value = '30';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Mute sound' }).click();
  await page.reload();
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const sound = await page.evaluate(() => window.__test.sound());
  expect(sound.muted).toBe(true);
  expect(sound.volume).toBe(0.3);
  await expect(page.getByRole('button', { name: 'Unmute sound' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('muted, nothing plays', async ({ page }) => {
  await spawned(page);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Mute sound' }).click();
  const before = await page.evaluate(() => window.__test.sound().played.length);
  await attackFreeLand(page);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__test.sound().played.length)).toBe(before);
});
