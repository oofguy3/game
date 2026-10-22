import { CONFIG } from '../../shared/config';
import type { NationId, TileIndex } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import type { Nation } from '../core/nation';
import { distance, forEachNeighbor, isLand, xOf, yOf } from '../map/grid';
import { adjacentWater, findWaterPath } from '../map/waterNav';
import { landTroops } from './attacks';
import { declareWar } from './relations';
import { advanceAlongPath, countUnits, removeUnit, spawnUnit } from './units';
import type { Unit } from './units';

const fail = (reason: string): CommandResult => ({ ok: false, reason });

/** How many troop boats a nation may have out at once: a base number, more with each active port. */
export function boatCap(game: Game, n: Nation): number {
  return CONFIG.units.troopBoat.baseCap + CONFIG.buildings.port.boatCapBonus * n.buildingCounts.port;
}

/**
 * Sends a troop boat carrying `troops` from `nation`'s nearest suitable coast to land on `target`: coastal land that
 * isn't the nation's own or an ally's, reached over a water body the nation's coast touches. The troops leave the
 * pool now; landing on someone's land declares war. Reports the reason on failure without emitting `rejected`.
 */
export function launchBoat(game: Game, nation: NationId, target: TileIndex, troops: number): CommandResult {
  const { map } = game;
  if (!Number.isInteger(target) || target < 0 || target >= map.width * map.height) return fail('off the map');
  if (!isLand(map, target)) return fail('not land');
  const owner = game.owner[target];
  if (owner === nation) return fail('own tile');
  if (owner !== 0 && game.relations.get(nation, owner) === 'allied') return fail('allied');
  if (map.coastal[target] === 0) return fail('not coastal');
  if (!(troops >= 1)) return fail('not enough troops');
  const n = game.nations[nation];
  if (countUnits(game, nation, 'troopBoat') >= boatCap(game, n)) return fail('too many boats out');

  const route = seaRoute(game, nation, target);
  if (route === null) return fail('no sea route');
  n.troops -= troops;
  if (owner !== 0) declareWar(game, nation, owner);
  spawnUnit(game, {
    type: 'troopBoat', owner: nation, x: xOf(map, route.from), y: yOf(map, route.from), troops,
    path: route.path, targetTile: target,
  });
  return { ok: true };
}

/** One tick of a troop boat: sail on; on reaching the beach, land the troops there. */
export function stepTroopBoat(game: Game, u: Unit): void {
  if (!advanceAlongPath(u, game.map, CONFIG.units.troopBoat.speed)) return;
  removeUnit(game, u.id, 0);
  landTroops(game, u.owner, u.targetTile, u.troops);
}

/**
 * The water route for a landing on `target`: from the water next to `nation`'s coastal border tile nearest the
 * target (over each water body the target touches), to the water next to the target. Null if none connects.
 */
function seaRoute(game: Game, nation: NationId, target: TileIndex): { from: TileIndex; path: TileIndex[] } | null {
  const { map } = game;
  const bodies = new Set<number>();
  forEachNeighbor(map, target, (t) => {
    if (map.waterBody[t] >= 0) bodies.add(map.waterBody[t]);
  });
  let best: { from: TileIndex; to: TileIndex; d: number } | null = null;
  for (const body of bodies) {
    const to = adjacentWater(map, target, body);
    if (to === null) continue;
    for (const b of game.nations[nation].border) {
      if (map.coastal[b] === 0) continue;
      const from = adjacentWater(map, b, body);
      if (from === null) continue;
      const d = distance(map, b, target);
      if (best === null || d < best.d) best = { from, to, d };
    }
  }
  if (best === null) return null;
  const path = findWaterPath(map, game.nav, best.from, best.to);
  return path === null ? null : { from: best.from, path };
}
