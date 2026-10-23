import { Terrain } from '../../shared/types';

export interface GameMap {
  width: number;
  height: number;
  /** One `Terrain` value per tile, row-major. */
  terrain: Uint8Array;
  /** Number of non-water tiles. */
  landCount: number;
  /** 1 when the tile is land with at least one water 4-neighbour (the map edge is not water), else 0. */
  coastal: Uint8Array;
  /** Water body id per tile, -1 on land. Ids follow row-major order of first encounter. */
  waterBody: Int32Array;
  /** Tile count of each water body, indexed by water body id. */
  waterBodySize: number[];
  /** Landmass id per tile, -1 on water. Ids follow row-major order of first encounter. */
  landmass: Int32Array;
  /** Tile count of each landmass, indexed by landmass id. */
  landmassSize: number[];
}

/**
 * Builds a GameMap from raw terrain, deriving land count, coast flags and the
 * water body / landmass labels (4-neighbour connectivity). Keeps `terrain` by reference.
 */
export function createGameMap(width: number, height: number, terrain: Uint8Array): GameMap {
  const n = width * height;
  if (terrain.length !== n) {
    throw new Error(`Terrain has ${terrain.length} tiles but a ${width}x${height} map needs ${n}`);
  }

  let landCount = 0;
  const coastal = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    if (terrain[t] === Terrain.Water) continue;
    landCount++;
    const x = t % width;
    if (
      (x > 0 && terrain[t - 1] === Terrain.Water) ||
      (x < width - 1 && terrain[t + 1] === Terrain.Water) ||
      (t >= width && terrain[t - width] === Terrain.Water) ||
      (t < n - width && terrain[t + width] === Terrain.Water)
    ) {
      coastal[t] = 1;
    }
  }

  const stack = new Int32Array(n);
  const water = labelRegions(width, height, terrain, false, stack);
  const land = labelRegions(width, height, terrain, true, stack);
  return {
    width,
    height,
    terrain,
    landCount,
    coastal,
    waterBody: water.labels,
    waterBodySize: water.sizes,
    landmass: land.labels,
    landmassSize: land.sizes,
  };
}

/**
 * Iterative 4-neighbour flood fill over all land (or all water) tiles.
 * Labels are -1 outside the region kind; ids are assigned in row-major order of first encounter.
 * `stack` is caller-provided scratch space of at least width*height entries.
 */
function labelRegions(
  width: number,
  height: number,
  terrain: Uint8Array,
  land: boolean,
  stack: Int32Array,
): { labels: Int32Array; sizes: number[] } {
  const n = width * height;
  const labels = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const matches = (t: number): boolean => (terrain[t] !== Terrain.Water) === land;

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || !matches(start)) continue;
    const id = sizes.length;
    let size = 0;
    let top = 0;
    labels[start] = id;
    stack[top++] = start;
    while (top > 0) {
      const t = stack[--top];
      size++;
      const x = t % width;
      if (x > 0 && labels[t - 1] === -1 && matches(t - 1)) { labels[t - 1] = id; stack[top++] = t - 1; }
      if (x < width - 1 && labels[t + 1] === -1 && matches(t + 1)) { labels[t + 1] = id; stack[top++] = t + 1; }
      if (t >= width && labels[t - width] === -1 && matches(t - width)) { labels[t - width] = id; stack[top++] = t - width; }
      if (t < n - width && labels[t + width] === -1 && matches(t + width)) { labels[t + width] = id; stack[top++] = t + width; }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}
