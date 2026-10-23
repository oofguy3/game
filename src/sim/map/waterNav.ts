import { CONFIG } from '../../shared/config';
import type { TileIndex } from '../../shared/types';
import { Terrain } from '../../shared/types';
import { MaxHeap } from '../util/heap';
import type { GameMap } from './gameMap';
import { forEachNeighbor } from './grid';

/**
 * Coarse navigation grid over the water of a map. Each cell is `cellSize` x `cellSize` tiles
 * (edge cells may be smaller) and remembers, for every water body that has a tile in it, one representative
 * water tile of that body, preferring the tile nearest the cell centre.
 */
export interface WaterNav {
  cellSize: number;
  cols: number;
  rows: number;
  /** Internal: first water body found in each cell (row-major cells), -1 when the cell has no water. */
  cellBody: Int32Array;
  /** Internal: representative tile of `cellBody` in each cell; only meaningful where `cellBody` is not -1. */
  cellTile: Int32Array;
  /** Internal: for the rare cells holding more than one water body, body -> representative tile of the others. */
  otherBodies: Map<number, Map<number, TileIndex>>;
}

/** Builds the coarse navigation grid for `map`. */
export function buildWaterNav(map: GameMap, cellSize: number = CONFIG.map.navCellSize): WaterNav {
  if (!Number.isInteger(cellSize) || cellSize < 1) {
    throw new Error(`Water nav cell size must be a positive integer, got ${cellSize}`);
  }
  const { width, height, waterBody } = map;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cellBody = new Int32Array(cols * rows).fill(-1);
  const cellTile = new Int32Array(cols * rows);
  const otherBodies = new Map<number, Map<number, TileIndex>>();

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cy * cols + cx;
      const x0 = cx * cellSize;
      const y0 = cy * cellSize;
      const x1 = Math.min(x0 + cellSize, width) - 1;
      const y1 = Math.min(y0 + cellSize, height) - 1;
      const centreX = (x0 + x1) / 2;
      const centreY = (y0 + y1) / 2;
      const distToCentre = (t: TileIndex): number => (t % width - centreX) ** 2 + (Math.floor(t / width) - centreY) ** 2;

      let others: Map<number, TileIndex> | undefined;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = y * width + x;
          const body = waterBody[t];
          if (body < 0) continue;
          if (cellBody[cell] === -1) {
            cellBody[cell] = body;
            cellTile[cell] = t;
          } else if (body === cellBody[cell]) {
            if (distToCentre(t) < distToCentre(cellTile[cell])) cellTile[cell] = t;
          } else {
            if (others === undefined) {
              others = new Map();
              otherBodies.set(cell, others);
            }
            const best = others.get(body);
            if (best === undefined || distToCentre(t) < distToCentre(best)) others.set(body, t);
          }
        }
      }
    }
  }
  return { cellSize, cols, rows, cellBody, cellTile, otherBodies };
}

/** The representative tile of `body` in `cell`, or -1 when that body has no tile there. */
function representative(nav: WaterNav, cell: number, body: number): TileIndex {
  if (nav.cellBody[cell] === body) return nav.cellTile[cell];
  return nav.otherBodies.get(cell)?.get(body) ?? -1;
}

function cellOfTile(map: GameMap, nav: WaterNav, t: TileIndex): number {
  const x = t % map.width;
  const y = Math.floor(t / map.width);
  return Math.floor(y / nav.cellSize) * nav.cols + Math.floor(x / nav.cellSize);
}

/**
 * Finds a route between two tiles of the same water body as a list of waypoints: one representative water tile
 * per cell visited after the start cell, with the last one replaced by `to`. When both tiles share a cell the
 * result is `[to]`. Returns null when either tile is not water or they lie in different water bodies.
 *
 * Runs A* over the 8-connected cells that hold water of that body (octile-distance heuristic).
 */
export function findWaterPath(map: GameMap, nav: WaterNav, from: TileIndex, to: TileIndex): TileIndex[] | null {
  if (map.terrain[from] !== Terrain.Water || map.terrain[to] !== Terrain.Water) return null;
  const body = map.waterBody[from];
  if (map.waterBody[to] !== body) return null;

  const { cols, rows } = nav;
  const start = cellOfTile(map, nav, from);
  const goal = cellOfTile(map, nav, to);
  if (start === goal) return [to];

  const goalX = goal % cols;
  const goalY = Math.floor(goal / cols);
  const heuristic = (x: number, y: number): number => {
    const dx = Math.abs(x - goalX);
    const dy = Math.abs(y - goalY);
    return Math.max(dx, dy) - Math.min(dx, dy) + Math.SQRT2 * Math.min(dx, dy);
  };

  const cost = new Float64Array(cols * rows).fill(Infinity);
  const parent = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const open = new MaxHeap();
  cost[start] = 0;
  open.push(start, -heuristic(start % cols, Math.floor(start / cols)));

  for (let cell = open.pop(); cell !== undefined; cell = open.pop()) {
    if (closed[cell]) continue;
    if (cell === goal) {
      const path: TileIndex[] = [to];
      for (let c = parent[goal]; c !== start; c = parent[c]) path.push(representative(nav, c, body));
      return path.reverse();
    }
    closed[cell] = 1;

    const cx = cell % cols;
    const cy = Math.floor(cell / cols);
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= rows) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        if ((dx === 0 && dy === 0) || nx < 0 || nx >= cols) continue;
        const next = ny * cols + nx;
        if (closed[next] || representative(nav, next, body) < 0) continue;
        const nextCost = cost[cell] + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (nextCost < cost[next]) {
          cost[next] = nextCost;
          parent[next] = cell;
          open.push(next, -(nextCost + heuristic(nx, ny)));
        }
      }
    }
  }
  return null;
}

/** A water 4-neighbour of `land` (of water body `body` when given), or null when there is none. */
export function adjacentWater(map: GameMap, land: TileIndex, body?: number): TileIndex | null {
  let found: TileIndex | null = null;
  forEachNeighbor(map, land, (n) => {
    if (found === null && map.terrain[n] === Terrain.Water && (body === undefined || map.waterBody[n] === body)) found = n;
  });
  return found;
}
