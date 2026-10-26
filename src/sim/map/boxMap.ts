import { CONFIG } from '../../shared/config';
import { Terrain } from '../../shared/types';
import type { MapSize } from '../../shared/types';
import { Rng } from '../util/rng';
import { createGameMap } from './gameMap';
import type { GameMap } from './gameMap';

/**
 * "The Box": a rectangle of land with no water. Plains, with hills and a few mountains so high ground still costs
 * more to take. The same seed always builds the same box.
 */
export function generateBoxMap(seed: number, size: MapSize): GameMap {
  const [width, height] = CONFIG.map.sizes[size];
  const rng = new Rng(seed);
  const terrain = new Uint8Array(width * height);
  for (let t = 0; t < terrain.length; t++) {
    const roll = rng.int(0, 999);
    if (roll >= 940) terrain[t] = Terrain.Mountains;
    else if (roll >= 820) terrain[t] = Terrain.Hills;
    else terrain[t] = Terrain.Plains;
  }
  return createGameMap(width, height, terrain);
}
