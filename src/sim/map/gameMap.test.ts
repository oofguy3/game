import { describe, expect, it } from 'vitest';
import { Terrain } from '../../shared/types';
import { mapFromAscii } from '../testing/asciiMap';
import { createGameMap } from './gameMap';
import { distance, forEachNeighbor, inBounds, isLand, tileOf, xOf, yOf } from './grid';

// 4 land tiles (two plains in row 1, plains + hills in row 2), 12 water tiles.
const m = mapFromAscii(['....', '.##.', '.#^.', '....']);

describe('createGameMap', () => {
  it('counts land and marks coast', () => {
    expect(m.landCount).toBe(4);
    expect(m.coastal[tileOf(m, 1, 1)]).toBe(1);
  });

  it('labels one water body and one landmass', () => {
    expect(m.waterBodySize).toEqual([12]);
    expect(m.landmassSize).toEqual([4]);
  });

  it('labels separate lakes', () => expect(mapFromAscii(['#####', '#.#.#', '#####']).waterBodySize).toEqual([1, 1]));

  it('labels separate landmasses in row-major order of first encounter', () => {
    const two = mapFromAscii(['#..^^', '#..^.', '.....']);
    expect(two.landmassSize).toEqual([2, 3]);
    expect(two.landmass[tileOf(two, 0, 0)]).toBe(0);
    expect(two.landmass[tileOf(two, 3, 0)]).toBe(1);
    expect(two.landmass[tileOf(two, 1, 0)]).toBe(-1);
    expect(two.waterBody[tileOf(two, 0, 0)]).toBe(-1);
    expect(two.waterBody[tileOf(two, 1, 0)]).toBe(0);
  });

  it('does not join landmasses or water bodies across a diagonal', () => {
    const diag = mapFromAscii(['#.', '.#']);
    expect(diag.landmassSize).toEqual([1, 1]);
    expect(diag.waterBodySize).toEqual([1, 1]);
  });

  it('marks only land with a water 4-neighbour as coastal, and ignores the map edge', () => {
    const land = mapFromAscii(['###', '###', '###']);
    expect([...land.coastal]).toEqual(new Array(9).fill(0));
    expect(land.waterBodySize).toEqual([]);
    const island = mapFromAscii(['.....', '.###.', '.###.', '.###.', '.....']);
    expect(island.coastal[tileOf(island, 2, 2)]).toBe(0);
    expect(island.coastal[tileOf(island, 1, 1)]).toBe(1);
    expect(island.coastal[tileOf(island, 2, 1)]).toBe(1);
    expect(island.coastal[tileOf(island, 0, 0)]).toBe(0);
  });

  it('handles an all-water map', () => {
    const sea = mapFromAscii(['...', '...']);
    expect(sea.landCount).toBe(0);
    expect(sea.waterBodySize).toEqual([6]);
    expect(sea.landmassSize).toEqual([]);
  });

  it('labels a large serpentine landmass iteratively without overflowing the stack', () => {
    const w = 400;
    const h = 400;
    const terrain = new Uint8Array(w * h).fill(Terrain.Plains);
    for (let y = 1; y < h; y += 2) for (let x = 0; x < w - 1; x++) terrain[y * w + x + (y % 4 === 1 ? 1 : 0)] = Terrain.Water;
    const big = createGameMap(w, h, terrain);
    expect(big.landmassSize).toHaveLength(1);
    expect(big.landmassSize[0]).toBe(big.landCount);
  });

  it('rejects a terrain array of the wrong size', () => {
    expect(() => createGameMap(3, 3, new Uint8Array(8))).toThrow();
  });
});

describe('grid helpers', () => {
  it('converts between tiles and coordinates', () => {
    const t = tileOf(m, 3, 2);
    expect(t).toBe(11);
    expect([xOf(m, t), yOf(m, t)]).toEqual([3, 2]);
  });

  it('checks bounds', () => {
    expect(inBounds(m, 0, 0)).toBe(true);
    expect(inBounds(m, 3, 3)).toBe(true);
    expect(inBounds(m, -1, 0)).toBe(false);
    expect(inBounds(m, 0, -1)).toBe(false);
    expect(inBounds(m, 4, 0)).toBe(false);
    expect(inBounds(m, 0, 4)).toBe(false);
  });

  it('neighbours do not wrap', () => {
    const out: number[] = [];
    forEachNeighbor(m, 0, n => out.push(n));
    expect(out.sort((a, b) => a - b)).toEqual([1, 4]);
    const right: number[] = [];
    forEachNeighbor(m, tileOf(m, 3, 1), n => right.push(n));
    expect(right.sort((a, b) => a - b)).toEqual([3, 6, 11]);
  });

  it('gives an interior tile four neighbours', () => {
    const out: number[] = [];
    forEachNeighbor(m, tileOf(m, 1, 1), n => out.push(n));
    expect(out.sort((a, b) => a - b)).toEqual([1, 4, 6, 9]);
  });

  it('knows land from water', () => {
    expect(isLand(m, tileOf(m, 0, 0))).toBe(false);
    expect(isLand(m, tileOf(m, 1, 1))).toBe(true);
    expect(isLand(m, tileOf(m, 2, 2))).toBe(true);
  });

  it('measures euclidean distance', () => {
    expect(distance(m, tileOf(m, 0, 0), tileOf(m, 3, 3))).toBeCloseTo(Math.sqrt(18));
    expect(distance(m, tileOf(m, 0, 0), tileOf(m, 3, 0))).toBe(3);
    expect(distance(m, 5, 5)).toBe(0);
  });
});

describe('mapFromAscii', () => {
  it('maps each character to its terrain', () => {
    const t = mapFromAscii(['.#^M']);
    expect([...t.terrain]).toEqual([Terrain.Water, Terrain.Plains, Terrain.Hills, Terrain.Mountains]);
  });

  it('throws on an unknown character', () => expect(() => mapFromAscii(['.#x'])).toThrow(/x/));

  it('throws on ragged rows', () => expect(() => mapFromAscii(['...', '..'])).toThrow());
});
