import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const GAME = '/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy';

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(GAME);
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  return errors;
}

test('the minimap shows the map, moves the camera, and M hides it', async ({ page }) => {
  const errors = await open(page);
  const mini = page.locator('.minimap canvas');
  await expect(mini).toBeVisible();
  const box = (await mini.boundingBox())!;
  // jump to the top-left quarter, then the middle
  await page.mouse.click(box.x + box.width / 4, box.y + box.height / 4);
  const centre = () => page.evaluate(() => {
    const c = window.__test.camera();
    return { x: c.x + window.innerWidth / (2 * c.zoom), y: c.y + window.innerHeight / (2 * c.zoom) };
  });
  const { width, height } = await page.evaluate(() => window.__test.state.init);
  let c = await centre();
  expect(Math.abs(c.x - width / 4)).toBeLessThan(2);
  expect(Math.abs(c.y - height / 4)).toBeLessThan(2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  c = await centre();
  expect(Math.abs(c.x - width / 2)).toBeLessThan(2);
  expect(Math.abs(c.y - height / 2)).toBeLessThan(2);
  await page.keyboard.press('m');
  await expect(page.locator('.minimap')).toBeHidden();
  await page.keyboard.press('m');
  await expect(page.locator('.minimap')).toBeVisible();
  expect(errors).toEqual([]);
});

test('hiding the minimap is remembered after a reload', async ({ page }) => {
  await open(page);
  await page.keyboard.press('m');
  await expect(page.locator('.minimap')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  await expect(page.locator('.minimap')).toBeHidden();
  expect(await page.evaluate(() => window.__test.minimap().visible)).toBe(false);
});
