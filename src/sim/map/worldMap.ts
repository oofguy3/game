import type { TileIndex } from '../../shared/types';
import { decodeMap } from './codec';
import type { GameMap } from './gameMap';

/**
 * Equirectangular projection of the real world onto the tile grid: x spans longitudes -180..180 and y spans
 * latitudes `latMax` (top row) down to `latMin`. The height is round(width * (latMax - latMin) / 360).
 */
export const WORLD_PROJECTION = { width: 1500, height: 567, latMax: 78, latMin: -58 } as const;

/** The tile containing the given position, clamped into the map. */
export function lonLatToTile(lon: number, lat: number): TileIndex {
  const { width, height, latMax, latMin } = WORLD_PROJECTION;
  const x = Math.floor(((lon + 180) / 360) * width);
  const y = Math.floor(((latMax - lat) / (latMax - latMin)) * height);
  return Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x));
}

/** Decodes the world map asset and checks that it matches `WORLD_PROJECTION`. */
export function decodeWorldMap(bytes: Uint8Array): GameMap {
  const map = decodeMap(bytes);
  const { width, height } = WORLD_PROJECTION;
  if (map.width !== width || map.height !== height) {
    throw new Error(`World map is ${map.width}x${map.height} but the projection needs ${width}x${height}`);
  }
  return map;
}
