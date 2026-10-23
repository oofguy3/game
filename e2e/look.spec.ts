import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const GAME = '/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy';
/** The same game drawn by the graphics chip even where it is only emulated (as in this test browser). */
const GL = `${GAME}&look=gl`;
type Rgb = [number, number, number];
const blue = ([r, g, b]: Rgb): boolean => b > r + 40 && b > g;

async function open(page: Page, url: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  return errors;
}
const sample = (page: Page, tile: number): Promise<Rgb> => page.evaluate((t) => window.__test.sampleMap(t), tile);

test('the map is drawn by the graphics chip: deep water is blue, and land is not', async ({ page }) => {
  const errors = await open(page, GL);
  expect(await page.evaluate(() => window.__test.look())).toBe('gl');
  const water = (await page.evaluate(() => window.__test.findWaterTile()))!;
  const land = (await page.evaluate(() => window.__test.findInlandTile()))!;
  expect(blue(await sample(page, water))).toBe(true);
  expect(blue(await sample(page, land))).toBe(false);
  await page.screenshot({ path: 'test-results/look-terrain.png' });
  expect(errors).toEqual([]);
});

test('the flat look is still there with ?look=flat', async ({ page }) => {
  const errors = await open(page, `${GAME}&look=flat`);
  expect(await page.evaluate(() => window.__test.look())).toBe('flat');
  const water = (await page.evaluate(() => window.__test.findWaterTile()))!;
  // the flat picture's water colour, 0x2b6596
  expect(await sample(page, water)).toEqual([0x2b, 0x65, 0x96]);
  expect(errors).toEqual([]);
});

test('without real graphics hardware the map uses the flat look', async ({ page }) => {
  const errors = await open(page, GAME);
  // a browser that only emulates the graphics chip refuses a context that must be fast
  const software = await page.evaluate(() =>
    document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true }) === null);
  expect(await page.evaluate(() => window.__test.look())).toBe(software ? 'flat' : 'gl');
  expect(errors).toEqual([]);
});

test('the map stays lined up after a resize and at both zoom limits', async ({ page }) => {
  const errors = await open(page, GL);
  await page.setViewportSize({ width: 900, height: 700 });
  const water = (await page.evaluate(() => window.__test.findWaterTile()))!;
  const land = (await page.evaluate(() => window.__test.findInlandTile()))!;
  for (const zoom of [0.5, 32]) {
    await page.evaluate(([z, t]) => window.__test.zoomTo(z, t), [zoom, water]);
    expect(blue(await sample(page, water))).toBe(true);
    await page.evaluate(([z, t]) => window.__test.zoomTo(z, t), [zoom, land]);
    expect(blue(await sample(page, land))).toBe(false);
  }
  expect(errors).toEqual([]);
});

const PLAYER: Rgb = [0x3b, 0x82, 0xf6];
const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("the player's land is tinted toward the player's colour", async ({ page }) => {
  const errors = await open(page, GL);
  await page.waitForFunction(() => [...window.__test.state.nations.values()].filter((n) => n.spawned).length >= 4);
  const tile = (await page.evaluate(() => window.__test.findLandTile('unowned')))!;
  await page.evaluate((t) => window.__test.zoomTo(8, t), tile);
  const before = await sample(page, tile);
  const s = await page.evaluate((t) => window.__test.tileToScreen(t), tile);
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 20_000 });
  await page.waitForTimeout(1200);
  const after = await sample(page, tile);
  expect(distance(before, PLAYER) - distance(after, PLAYER)).toBeGreaterThan(30);
  await page.screenshot({ path: 'test-results/look-territories.png' });
  expect(errors).toEqual([]);
});

test('a lost graphics context falls back to the flat look and keeps drawing', async ({ page }) => {
  const errors = await open(page, GL);
  expect(await page.evaluate(() => window.__test.look())).toBe('gl');
  await page.evaluate(() => window.__test.loseContext());
  await expect.poll(() => page.evaluate(() => window.__test.look())).toBe('flat');
  const water = (await page.evaluate(() => window.__test.findWaterTile()))!;
  expect(await sample(page, water)).toEqual([0x2b, 0x65, 0x96]);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

/** The median time between animation frames over the next `count` frames, in ms. */
const frameInterval = (page: Page, count = 120): Promise<number> => page.evaluate((n) => new Promise<number>((resolve) => {
  const gaps: number[] = [];
  let last = 0;
  const step = (now: number): void => {
    if (last) gaps.push(now - last);
    last = now;
    if (gaps.length < n) requestAnimationFrame(step);
    else resolve(gaps.sort((a, b) => a - b)[Math.floor(n / 2)]);
  };
  requestAnimationFrame(step);
}), count);

test('the world map with 40 bots stays smooth: cheap to draw and close to 60 frames a second', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, '/game/?autostart=1&test=1&map=world&bots=40&difficulty=easy');
  await page.waitForFunction(() => [...window.__test.state.nations.values()].filter((n) => n.spawned).length >= 40);
  const s = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!));
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 30_000 });
  await page.waitForTimeout(4000);
  const stats = await page.evaluate(() => window.__test.frameStats());
  expect(stats.frames).toBeGreaterThan(60);
  expect(stats.mean).toBeLessThan(8);
  // the drawing call returns quickly even when the graphics work behind it is slow, so also time whole frames
  expect(await frameInterval(page)).toBeLessThan(25);
});
