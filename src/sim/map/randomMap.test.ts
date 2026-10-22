import { describe, expect, it } from 'vitest';
import { Terrain } from '../../shared/types';
import { Rng } from '../util/rng';
import { tileOf } from './grid';
import { applyRelief, generateRandomMap } from './randomMap';

describe('generateRandomMap', () => {
  it('is deterministic', () => expect(generateRandomMap(5, 'small').terrain).toEqual(generateRandomMap(5, 'small').terrain));

  it('differs by seed', () => expect(generateRandomMap(5, 'small').terrain).not.toEqual(generateRandomMap(6, 'small').terrain));

  it('uses configured sizes', () => {
    const m = generateRandomMap(1, 'medium');
    expect([m.width, m.height]).toEqual([800, 450]);
  });

  it('has 35–45% land and a water border', () => {
    const m = generateRandomMap(1, 'small');
    const f = m.landCount / (m.width * m.height);
    expect(f).toBeGreaterThan(0.35);
    expect(f).toBeLessThan(0.45);
    for (let x = 0; x < m.width; x++) {
      expect(m.terrain[tileOf(m, x, 0)]).toBe(Terrain.Water);
      expect(m.terrain[tileOf(m, x, m.height - 1)]).toBe(Terrain.Water);
    }
  });

  it('contains plains, hills and mountains', () => {
    const t = new Set(generateRandomMap(2, 'small').terrain);
    expect([1, 2, 3].every(v => t.has(v))).toBe(true);
  });
});

describe('applyRelief', () => {
  it('turns 12% of land into mountains and 23% into hills, leaving water alone', () => {
    const width = 100;
    const height = 80;
    const terrain = new Uint8Array(width * height).fill(Terrain.Plains);
    for (let x = 0; x < width; x++) terrain[x] = Terrain.Water; // top row stays water
    const land = terrain.length - width;

    applyRelief(terrain, width, height, new Rng(7));

    const count = (v: number): number => terrain.reduce((n, t) => n + (t === v ? 1 : 0), 0);
    expect(count(Terrain.Water)).toBe(width);
    expect(count(Terrain.Mountains)).toBeCloseTo(land * 0.12, -1);
    expect(count(Terrain.Hills)).toBeCloseTo(land * 0.23, -1);
  });
});
