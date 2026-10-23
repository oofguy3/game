import { CONFIG } from '../../shared/config';
import type { NationId, TileIndex } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import type { Nation } from '../core/nation';
import type { GameMap } from '../map/gameMap';
import { distance, inBounds, isLand, tileOf, xOf, yOf } from '../map/grid';
import type { Rng } from '../util/rng';

const fail = (reason: string): CommandResult => ({ ok: false, reason });

/**
 * Puts (or moves) `nation`'s start at `tile`. Valid only in the spawn phase, on land that is unowned (or already the
 * nation's own, since its old disk is released first), at least `game.spawnSpacing` from every other nation's spawn.
 * On success the nation's old disk is released, a new one is claimed, and troops and gold are set to the start values.
 * Reports the reason on failure without emitting `rejected`; `applyCommand` does that.
 */
export function spawnNation(game: Game, nation: Nation, tile: TileIndex): CommandResult {
  if (game.phase !== 'spawn') return fail('wrong phase');
  const { map } = game;
  if (!Number.isInteger(tile) || tile < 0 || tile >= map.width * map.height) return fail('off the map');
  if (!isLand(map, tile)) return fail('not land');
  const owner = game.owner[tile];
  if (owner !== 0 && owner !== nation.id) return fail('tile is owned');
  if (!farFromAll(map, tile, game.spawnSpacing, spawnTilesExcept(game, nation.id))) {
    return fail('too close to another spawn');
  }
  placeSpawn(game, nation, tile);
  return { ok: true };
}

/**
 * A random unowned land tile for a nation that never chose one, at least `spacing` from every spawn. Samples up to
 * `CONFIG.spawn.randomSamples` land tiles; when none qualifies the spacing shrinks by `spacingRelax` and it tries again,
 * until the spacing would fall below `minDistanceFloor`. A last pass takes any unowned land. Null only when none is left.
 * Draws only from `rng`.
 */
export function randomSpawnTile(game: Game, rng: Rng, spacing: number = game.spawnSpacing): TileIndex | null {
  if (game.map.landCount === 0) return null;
  const others = spawnTilesExcept(game);
  for (let s = spacing; ; ) {
    const tile = sampleSpawnTile(game, rng, s, others);
    if (tile !== null) return tile;
    s *= CONFIG.spawn.spacingRelax;
    if (s < CONFIG.spawn.minDistanceFloor) break;
  }
  return anyUnownedLand(game, rng);
}

/**
 * Ends the spawn phase: every living nation that has not spawned gets a random start, in id order, from `game.rng`.
 * A nation with no land left to start on is eliminated (by no one: `by` 0). Then the game moves on to the playing phase.
 */
export function endSpawnPhase(game: Game): void {
  for (const nation of game.nations) {
    if (!nation.alive || nation.spawned) continue;
    const tile = randomSpawnTile(game, game.rng);
    if (tile === null) {
      nation.alive = false;
      game.emit({ type: 'eliminated', nation: nation.id, by: 0 });
    } else placeSpawn(game, nation, tile);
  }
  game.phase = 'playing';
  game.emit({ type: 'phase', phase: 'playing' });
}

/** Releases the nation's previous disk, claims the free land of the new one and gives the start resources. */
function placeSpawn(game: Game, nation: Nation, tile: TileIndex): void {
  if (nation.spawnTile >= 0) {
    forEachDiskTile(game.map, nation.spawnTile, (t) => {
      if (game.owner[t] === nation.id) game.setOwner(t, 0);
    });
  }
  forEachDiskTile(game.map, tile, (t) => {
    if (isLand(game.map, t) && game.owner[t] === 0) game.setOwner(t, nation.id);
  });
  nation.spawned = true;
  nation.spawnTile = tile;
  nation.troops = CONFIG.spawn.startTroops;
  nation.gold = CONFIG.spawn.startGold;
  game.emit({ type: 'spawned', nation: nation.id, tile });
}

/** Calls `fn` for each in-bounds tile within `CONFIG.spawn.radius` of `centre` (dx² + dy² <= radius²), row by row. */
function forEachDiskTile(map: GameMap, centre: TileIndex, fn: (t: TileIndex) => void): void {
  const r = CONFIG.spawn.radius;
  const cx = xOf(map, centre);
  const cy = yOf(map, centre);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (inBounds(map, x, y) && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) fn(tileOf(map, x, y));
    }
  }
}

/** The spawn tiles of every nation that has spawned, other than `except`. */
function spawnTilesExcept(game: Game, except?: NationId): TileIndex[] {
  const tiles: TileIndex[] = [];
  for (const n of game.nations) if (n.id !== except && n.spawnTile >= 0) tiles.push(n.spawnTile);
  return tiles;
}

function farFromAll(map: GameMap, tile: TileIndex, spacing: number, others: readonly TileIndex[]): boolean {
  return others.every((other) => distance(map, tile, other) >= spacing);
}

/** One pass of `randomSpawnTile`: tries random land tiles for one that is free and `spacing` clear of `others`. */
function sampleSpawnTile(game: Game, rng: Rng, spacing: number, others: readonly TileIndex[]): TileIndex | null {
  const { map } = game;
  const size = map.width * map.height;
  for (let landSamples = 0; landSamples < CONFIG.spawn.randomSamples; ) {
    const tile = rng.int(0, size - 1);
    if (!isLand(map, tile)) continue;
    landSamples++;
    if (game.owner[tile] === 0 && farFromAll(map, tile, spacing, others)) return tile;
  }
  return null;
}

/** The first unowned land tile found scanning (and wrapping) from a random start, or null if there is none. */
function anyUnownedLand(game: Game, rng: Rng): TileIndex | null {
  const size = game.map.width * game.map.height;
  const start = rng.int(0, size - 1);
  for (let i = 0; i < size; i++) {
    const tile = (start + i) % size;
    if (isLand(game.map, tile) && game.owner[tile] === 0) return tile;
  }
  return null;
}
