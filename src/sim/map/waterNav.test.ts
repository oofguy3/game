import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import { Terrain } from '../../shared/types';
import { mapFromAscii } from '../testing/asciiMap';
import { tileOf, xOf, yOf } from './grid';
import { buildWaterNav, findWaterPath, adjacentWater } from './waterNav';
import { decodeWorldMap, lonLatToTile } from './worldMap';

const m = mapFromAscii([
  '..........', '.########.', '.#......#.', '.#.####.#.', '.#......#.', '.########.', '..........',
]); // outer ring of sea + an inner lake
const nav = buildWaterNav(m, 2);

/** Row-major cell of a tile for a nav with the given cell size. */
const cellOf = (map: typeof m, size: number, t: number): [number, number] =>
  [Math.floor(xOf(map, t) / size), Math.floor(yOf(map, t) / size)];

describe('buildWaterNav', () => {
  it('covers the map with ceil(size / cellSize) cells per axis', () => {
    expect([nav.cellSize, nav.cols, nav.rows]).toEqual([2, 5, 4]);
  });

  it('defaults to the configured cell size', () => {
    const big = mapFromAscii(['.'.repeat(20), '.'.repeat(20)]);
    const defaulted = buildWaterNav(big);
    expect(defaulted.cellSize).toBe(CONFIG.map.navCellSize);
    expect(defaulted.cols).toBe(Math.ceil(20 / CONFIG.map.navCellSize));
  });

  it('rejects a cell size that is not a positive integer', () => {
    expect(() => buildWaterNav(m, 0)).toThrow();
    expect(() => buildWaterNav(m, 1.5)).toThrow();
  });
});

describe('findWaterPath', () => {
  it('null across different water bodies', () =>
    expect(findWaterPath(m, nav, tileOf(m, 0, 0), tileOf(m, 3, 2))).toBeNull());

  it('paths around land and ends at target', () => {
    const p = findWaterPath(m, nav, tileOf(m, 0, 0), tileOf(m, 9, 6))!;
    expect(p.at(-1)).toBe(tileOf(m, 9, 6));
    for (const t of p) expect(m.terrain[t]).toBe(Terrain.Water);
  });

  it('from === to', () => expect(findWaterPath(m, nav, 0, 0)).toEqual([0]));

  it('is [to] when both tiles share a cell', () => {
    const open = mapFromAscii(['....', '....']);
    expect(findWaterPath(open, buildWaterNav(open, 2), tileOf(open, 0, 0), tileOf(open, 1, 1))).toEqual([tileOf(open, 1, 1)]);
  });

  it('null when an endpoint is not water', () => {
    const land = tileOf(m, 1, 1);
    expect(findWaterPath(m, nav, land, tileOf(m, 0, 0))).toBeNull();
    expect(findWaterPath(m, nav, tileOf(m, 0, 0), land)).toBeNull();
  });

  it('visits a chain of adjacent cells, excluding the start cell', () => {
    const from = tileOf(m, 0, 0);
    const p = findWaterPath(m, nav, from, tileOf(m, 9, 6))!;
    const cells = [from, ...p].map((t) => cellOf(m, 2, t));
    for (let i = 1; i < cells.length; i++) {
      expect(Math.max(Math.abs(cells[i][0] - cells[i - 1][0]), Math.abs(cells[i][1] - cells[i - 1][1]))).toBe(1);
    }
  });

  it('uses diagonal steps, so the route is as short as the octile distance', () => {
    const open = mapFromAscii(['..........', '..........', '..........', '..........', '..........']);
    const p = findWaterPath(open, buildWaterNav(open, 1), tileOf(open, 0, 0), tileOf(open, 9, 4))!;
    expect(p).toHaveLength(9);
  });

  it('finds the shortest route round an obstacle', () => {
    const bay = mapFromAscii(['.......', '.#####.', '.#####.', '.#####.', '.......']);
    const p = findWaterPath(bay, buildWaterNav(bay, 1), tileOf(bay, 0, 2), tileOf(bay, 6, 2))!;
    // Up one, diagonally to the top row, five along (4 + 1 diagonal down), then down one: 8 steps.
    expect(p).toHaveLength(8);
    for (const t of p) expect(bay.terrain[t]).toBe(Terrain.Water);
  });

  it('uses the tile nearest the cell centre as the waypoint', () => {
    const open = mapFromAscii(['.........', '.........', '.........']);
    const p = findWaterPath(open, buildWaterNav(open, 3), tileOf(open, 0, 0), tileOf(open, 8, 0))!;
    expect(p).toEqual([tileOf(open, 4, 1), tileOf(open, 8, 0)]);
  });

  it('routes through a cell holding a second water body using that body\'s tile', () => {
    // The middle cell (x 5..9) has a one-tile pond of its own right at its centre; the sea only touches its bottom row.
    const pond = mapFromAscii([
      '.....#####.....',
      '.....#####.....',
      '.....##.##.....',
      '.....#####.....',
      '...............',
    ]);
    const pondNav = buildWaterNav(pond, 5);
    const from = tileOf(pond, 0, 0);
    const p = findWaterPath(pond, pondNav, from, tileOf(pond, 14, 0))!;
    expect(p).toHaveLength(2);
    expect(pond.waterBody[p[0]]).toBe(pond.waterBody[from]);
    expect(xOf(pond, p[0])).toBeGreaterThanOrEqual(5);
    expect(xOf(pond, p[0])).toBeLessThanOrEqual(9);
    // The pond itself is a separate body.
    const pondTile = tileOf(pond, 7, 2);
    expect(findWaterPath(pond, pondNav, from, pondTile)).toBeNull();
    expect(findWaterPath(pond, pondNav, pondTile, pondTile)).toEqual([pondTile]);
  });

  it('gives the same path every time', () => {
    const a = findWaterPath(m, nav, tileOf(m, 0, 0), tileOf(m, 9, 6));
    const b = findWaterPath(m, nav, tileOf(m, 0, 0), tileOf(m, 9, 6));
    expect(a).toEqual(b);
  });
});

describe('adjacentWater', () => {
  it('adjacentWater finds a water neighbour', () =>
    expect(m.terrain[adjacentWater(m, tileOf(m, 1, 1))!]).toBe(Terrain.Water));

  it('is null when no 4-neighbour is water', () => {
    const inland = mapFromAscii(['###', '###', '###']);
    expect(adjacentWater(inland, tileOf(inland, 1, 1))).toBeNull();
  });

  it('restricts the result to the requested body', () => {
    const lakeBody = m.waterBody[tileOf(m, 3, 2)];
    const seaBody = m.waterBody[tileOf(m, 0, 0)];
    // (2,1) touches the sea above (2,0) and the lake below (2,2).
    const land = tileOf(m, 2, 1);
    expect(m.waterBody[adjacentWater(m, land, lakeBody)!]).toBe(lakeBody);
    expect(m.waterBody[adjacentWater(m, land, seaBody)!]).toBe(seaBody);
    expect(adjacentWater(m, tileOf(m, 1, 2), lakeBody)).not.toBeNull();
    expect(adjacentWater(m, tileOf(m, 4, 3), seaBody)).toBeNull();
  });
});

describe('world map', () => {
  const world = decodeWorldMap(new Uint8Array(readFileSync('public/maps/world.bin')));
  const worldNav = buildWaterNav(world);

  it('Atlantic → Indian Ocean path in < 50 ms', () => {
    const from = lonLatToTile(-30, 0);
    const to = lonLatToTile(80, -20);
    expect(world.terrain[from]).toBe(Terrain.Water);
    expect(world.terrain[to]).toBe(Terrain.Water);

    const start = performance.now();
    const p = findWaterPath(world, worldNav, from, to);
    const elapsed = performance.now() - start;

    expect(p).not.toBeNull();
    expect(p!.at(-1)).toBe(to);
    for (const t of p!) expect(world.terrain[t]).toBe(Terrain.Water);
    expect(elapsed).toBeLessThan(50);
  });
});
