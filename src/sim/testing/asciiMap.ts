import { Terrain } from '../../shared/types';
import { createGameMap } from '../map/gameMap';
import type { GameMap } from '../map/gameMap';

const TERRAIN_OF_CHAR: Readonly<Record<string, Terrain>> = {
  '.': Terrain.Water,
  '#': Terrain.Plains,
  '^': Terrain.Hills,
  M: Terrain.Mountains,
};

/** Test helper: builds a map from rows of `.` water, `#` plains, `^` hills and `M` mountains. */
export function mapFromAscii(rows: string[]): GameMap {
  if (rows.length === 0 || rows[0].length === 0) throw new Error('mapFromAscii needs at least one non-empty row');
  const width = rows[0].length;
  const height = rows.length;
  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (row.length !== width) {
      throw new Error(`Ragged ascii map: row ${y} has ${row.length} characters, expected ${width}`);
    }
    for (let x = 0; x < width; x++) {
      const t = Object.hasOwn(TERRAIN_OF_CHAR, row[x]) ? TERRAIN_OF_CHAR[row[x]] : undefined;
      if (t === undefined) throw new Error(`Unknown ascii map character '${row[x]}' at row ${y}, column ${x}`);
      terrain[y * width + x] = t;
    }
  }
  return createGameMap(width, height, terrain);
}
