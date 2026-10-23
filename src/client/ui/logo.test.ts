import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { badgeSvg, LOGO_BLUE, LOGO_RED } from './logo';

describe('logo', () => {
  it('the tab icon file is exactly the badge', () => {
    const file = readFileSync(new URL('../../../public/favicon.svg', import.meta.url), 'utf8');
    expect(file).toBe(`${badgeSvg()}\n`);
  });

  it('the badge is a 100×100 globe, blue on the left and red on the right, cut by a jagged white border', () => {
    const svg = badgeSvg();
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain(LOGO_BLUE);
    expect(svg).toContain(LOGO_RED);
    const pts = /class="border"[^>]*points="([^"]+)"/.exec(svg)![1].trim().split(/\s+/).map((p) => p.split(',').map(Number));
    expect(pts.length).toBeGreaterThanOrEqual(7);
    expect(pts[0][1]).toBeLessThanOrEqual(2);
    expect(pts.at(-1)![1]).toBeGreaterThanOrEqual(98);
    for (const [x] of pts) {
      expect(x).toBeGreaterThan(35);
      expect(x).toBeLessThan(65);
    }
    // jagged: the x direction keeps flipping
    const turns = pts.slice(2).filter((p, i) => Math.sign(p[0] - pts[i + 1][0]) !== Math.sign(pts[i + 1][0] - pts[i][0]));
    expect(turns.length).toBeGreaterThanOrEqual(4);
  });

  it('is the same every time', () => {
    expect(badgeSvg()).toBe(badgeSvg());
  });
});
