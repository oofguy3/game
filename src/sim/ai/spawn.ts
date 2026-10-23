import { CONFIG } from '../../shared/config';
import { Terrain } from '../../shared/types';
import type { NationId, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { distance, inBounds, isLand, tileOf, xOf, yOf } from '../map/grid';
import type { Rng } from '../util/rng';
import type { DifficultyProfile } from './profile';

/**
 * Where bot `me` starts: of up to `profile.spawnSamples` valid random tiles (unowned land at least `game.spawnSpacing`
 * from every other spawn and from each `reserved` tile), the best by
 * min(1, landmass size / `spawnLandmassTarget`) × `spawnLandmassWeight`
 * + min(1, distance to the nearest spawn / (spacing × `spawnSpacingReach`))
 * + `spawnPlainsWeight` × the plains share within `spawnPlainsRadius`.
 * Easy (one sample) takes the first valid tile. Null when no valid tile turns up. Draws only from `rng`.
 */
export function chooseSpawn(
  game: Game,
  me: NationId,
  profile: DifficultyProfile,
  rng: Rng,
  reserved: readonly TileIndex[] = [],
): TileIndex | null {
  const { map } = game;
  if (map.landCount === 0) return null;
  const others = [...reserved];
  for (const n of game.nations) if (n.id !== me && n.spawnTile >= 0) others.push(n.spawnTile);

  const ai = CONFIG.ai;
  const spacing = game.spawnSpacing;
  const size = map.width * map.height;
  const maxDraws = Math.max(ai.spawnMinDraws, profile.spawnSamples * ai.spawnDrawsPerSample);
  let best: TileIndex | null = null;
  let bestScore = -Infinity;
  let found = 0;
  for (let draws = 0; draws < maxDraws && found < profile.spawnSamples; draws++) {
    const tile = rng.int(0, size - 1);
    if (!isLand(map, tile) || game.owner[tile] !== 0) continue;
    const nearest = nearestDistance(game, tile, others);
    if (nearest < spacing) continue;
    found++;
    if (profile.spawnSamples === 1) return tile;
    const score =
      Math.min(1, map.landmassSize[map.landmass[tile]] / ai.spawnLandmassTarget) * ai.spawnLandmassWeight +
      Math.min(1, nearest / (spacing * ai.spawnSpacingReach)) +
      ai.spawnPlainsWeight * plainsShare(game, tile, ai.spawnPlainsRadius);
    if (score > bestScore) {
      best = tile;
      bestScore = score;
    }
  }
  return best;
}

/** Distance from `tile` to the nearest of `spawns`; Infinity when there are none. */
function nearestDistance(game: Game, tile: TileIndex, spawns: readonly TileIndex[]): number {
  let best = Infinity;
  for (const s of spawns) best = Math.min(best, distance(game.map, tile, s));
  return best;
}

/** The share of land tiles within `radius` of `tile` that are plains. */
function plainsShare(game: Game, tile: TileIndex, radius: number): number {
  const { map } = game;
  const cx = xOf(map, tile);
  const cy = yOf(map, tile);
  let land = 0;
  let plains = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius || !inBounds(map, cx + dx, cy + dy)) continue;
      const t = tileOf(map, cx + dx, cy + dy);
      if (!isLand(map, t)) continue;
      land++;
      if (map.terrain[t] === Terrain.Plains) plains++;
    }
  }
  return land === 0 ? 0 : plains / land;
}
