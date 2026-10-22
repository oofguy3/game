import type { TileIndex } from '../../shared/types';
import { Terrain } from '../../shared/types';
import type { GameMap } from './gameMap';

export function tileOf(map: GameMap, x: number, y: number): TileIndex {
  return y * map.width + x;
}

export function xOf(map: GameMap, t: TileIndex): number {
  return t % map.width;
}

export function yOf(map: GameMap, t: TileIndex): number {
  return Math.floor(t / map.width);
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && x < map.width && y >= 0 && y < map.height;
}

/** Calls `fn` for each in-bounds 4-neighbour of `t` (no wrap-around). */
export function forEachNeighbor(map: GameMap, t: TileIndex, fn: (n: TileIndex) => void): void {
  const { width, height } = map;
  const x = t % width;
  const y = Math.floor(t / width);
  if (y > 0) fn(t - width);
  if (x > 0) fn(t - 1);
  if (x < width - 1) fn(t + 1);
  if (y < height - 1) fn(t + width);
}

export function isLand(map: GameMap, t: TileIndex): boolean {
  return map.terrain[t] !== Terrain.Water;
}

/** Euclidean distance between two tile centres, in tiles. */
export function distance(map: GameMap, a: TileIndex, b: TileIndex): number {
  const dx = xOf(map, a) - xOf(map, b);
  const dy = yOf(map, a) - yOf(map, b);
  return Math.sqrt(dx * dx + dy * dy);
}
