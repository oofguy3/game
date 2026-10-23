import { describe, expect, it } from 'vitest';
import { Terrain } from '../../../shared/types';
import type { LookOptions } from '../../../worker/protocol';
import { buildTerrainLook, COAST_RANGE, decodeCoast } from './terrainLook';

/** `.` water, `#` plains, `^` hills, `M` mountains. */
function terrainFrom(rows: string[]): { width: number; height: number; terrain: Uint8Array } {
  const width = rows[0].length;
  const height = rows.length;
  const codes: Record<string, number> = { '.': Terrain.Water, '#': Terrain.Plains, '^': Terrain.Hills, M: Terrain.Mountains };
  const terrain = new Uint8Array(width * height);
  rows.forEach((row, y) => [...row].forEach((c, x) => { terrain[y * width + x] = codes[c]; }));
  return { width, height, terrain };
}
const grid = (w: number, h: number, at: (x: number, y: number) => string): string[] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y)).join(''));
const look = (top: number, bottom: number, seed = 1, dryBands = false): LookOptions => ({ latitude: { top, bottom }, seed, dryBands });
const build = (rows: string[], options: LookOptions) => {
  const { width, height, terrain } = terrainFrom(rows);
  return { ...buildTerrainLook(width, height, terrain, options), terrain, at: (x: number, y: number) => y * width + x };
};
const FOREST = 0;
const DRY = 1;
const SNOW = 2;

describe('buildTerrainLook', () => {
  it('coast distance is positive on land, negative on water, about ±0.5 either side of the shore', () => {
    const l = build(grid(20, 9, (x) => (x < 10 ? '.' : '#')), look(10, -10));
    expect(decodeCoast(l.coast[l.at(10, 4)])).toBeCloseTo(0.5, 1);
    expect(decodeCoast(l.coast[l.at(9, 4)])).toBeCloseTo(-0.5, 1);
    expect(decodeCoast(l.coast[l.at(16, 4)])).toBeGreaterThan(5);
    expect(decodeCoast(l.coast[l.at(3, 4)])).toBeLessThan(-5);
  });

  it('coast distance stops at ±COAST_RANGE', () => {
    const l = build(grid(60, 10, (x, y) => (x < 3 && y > 3 && y < 6 ? '#' : '.')), look(10, -10));
    expect(decodeCoast(l.coast[l.at(55, 5)])).toBeCloseTo(-COAST_RANGE, 1);
    const land = build(grid(30, 30, () => '#'), look(10, -10));
    expect(decodeCoast(land.coast[land.at(15, 15)])).toBeCloseTo(COAST_RANGE, 1);
  });

  it('snow follows latitude: none near the equator, full beyond 68°', () => {
    const l = build(grid(10, 40, () => '#'), look(80, -80));
    expect(l.biome[4 * l.at(5, 20) + SNOW]).toBe(0);
    expect(l.biome[4 * l.at(5, 0) + SNOW]).toBe(255);
    expect(l.biome[4 * l.at(5, 39) + SNOW]).toBe(255);
  });

  it('high mountains get snow caps even at the equator', () => {
    const l = build(grid(21, 21, (x, y) => (x >= 6 && x <= 14 && y >= 6 && y <= 14 ? 'M' : '#')), look(5, -5));
    expect(l.biome[4 * l.at(10, 10) + SNOW]).toBeGreaterThanOrEqual(200);
    expect(l.biome[4 * l.at(1, 1) + SNOW]).toBe(0);
  });

  it('never puts forest on beaches, snow or mountains', () => {
    const rows = grid(80, 60, (x, y) => (x < 12 || (x > 50 && y > 40) ? '.' : x > 60 ? 'M' : y % 13 < 4 ? '^' : '#'));
    const l = build(rows, look(75, -75, 3));
    let forested = 0;
    for (let t = 0; t < l.terrain.length; t++) {
      if (l.biome[4 * t + FOREST] === 0) continue;
      forested++;
      expect([Terrain.Plains, Terrain.Hills]).toContain(l.terrain[t]);
      // the 1.5-tile rule is checked after one-byte encoding, which is good to about ±0.03 of a tile
      expect(decodeCoast(l.coast[t])).toBeGreaterThanOrEqual(1.45);
      expect(l.biome[4 * t + SNOW]).toBeLessThan(77);
    }
    expect(forested).toBeGreaterThan(0);
  });

  it('puts forest on a fair part of a big green map', () => {
    const l = build(grid(120, 80, (_x, y) => (y % 20 < 5 ? '^' : '#')), look(30, -30, 2));
    let forested = 0;
    for (let t = 0; t < l.terrain.length; t++) if (l.biome[4 * t + FOREST] > 0) forested++;
    expect(forested / l.terrain.length).toBeGreaterThan(0.05);
  });

  it('dry bands make the subtropics drier than the equator', () => {
    const l = build(grid(40, 80, () => '#'), look(40, -40, 5, true));
    const meanDry = (rows: number[]): number => {
      let sum = 0;
      for (const y of rows) for (let x = 0; x < 40; x++) sum += l.biome[4 * l.at(x, y) + DRY];
      return sum / (rows.length * 40);
    };
    // row y sits at latitude 39.5 - y
    expect(meanDry([14, 15, 64, 65])).toBeGreaterThan(meanDry([39, 40]) + 50);
  });

  it('the same inputs give the same look, and another seed moves the forests', () => {
    const rows = grid(60, 40, (x, y) => (x < 8 ? '.' : (x + y) % 17 < 4 ? '^' : '#'));
    const a = build(rows, look(40, -40, 4));
    const b = build(rows, look(40, -40, 4));
    expect(a.coast).toEqual(b.coast);
    expect(a.shade).toEqual(b.shade);
    expect(a.biome).toEqual(b.biome);
    const c = build(rows, look(40, -40, 5));
    const forest = (biome: Uint8Array): number[] => Array.from({ length: biome.length / 4 }, (_, t) => biome[4 * t]);
    expect(forest(c.biome)).not.toEqual(forest(a.biome));
  });

  it('hill shading lights the top-left side of a mountain and darkens the bottom-right side', () => {
    const l = build(grid(21, 21, (x, y) => (x >= 8 && x <= 12 && y >= 8 && y <= 12 ? 'M' : '#')), look(5, -5));
    expect(l.shade[l.at(8, 8)]).toBeGreaterThan(140);
    expect(l.shade[l.at(12, 12)]).toBeLessThan(116);
  });

  it('keeps rock as 0 for plains and water, 128 for hills and 255 for mountains', () => {
    const l = build(['.#^M'], look(5, -5));
    expect([0, 1, 2, 3].map((t) => l.biome[4 * t + 3])).toEqual([0, 0, 128, 255]);
  });
});
