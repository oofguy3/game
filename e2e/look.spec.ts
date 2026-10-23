import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const GAME = '/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy';
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
  const errors = await open(page, GAME);
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

test('the map stays lined up after a resize and at both zoom limits', async ({ page }) => {
  const errors = await open(page, GAME);
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
