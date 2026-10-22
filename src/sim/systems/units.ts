import type { NationId, TileIndex, UnitType } from '../../shared/types';
import type { Game } from '../core/game';
import type { GameMap } from '../map/gameMap';
import { xOf, yOf } from '../map/grid';
import { spawnTradePlanes, stepAntiAir, stepPlane, stepRadarWarnings } from './air';
import { spawnTradeShips, stepTradeShip, stepTroopBoat, stepWarship } from './naval';

/** Anything that moves over the map: boats, ships and planes. Positions are in tile coordinates. */
export interface Unit {
  id: number;
  type: UnitType;
  owner: NationId;
  x: number;
  y: number;
  hp: number;
  /** Troops aboard (troop boats and paratrooper planes). */
  troops: number;
  /** Waypoints to visit, in order. */
  path: TileIndex[];
  /** The waypoint being headed for. */
  pathIndex: number;
  /** Where the unit's mission ends (a landing beach, a bombing target…); -1 when none. */
  targetTile: TileIndex;
  /** The building it came from. */
  homeId: number | null;
  /** The building it is heading for. */
  destId: number | null;
  patrol: TileIndex | null;
  cooldown: number;
  mission: 'outbound' | 'returning' | 'patrol';
  /** Nations already warned about this unit by their radar. */
  warned: Set<NationId>;
  /** For trade units: who owned the destination when it set out (the trade only pays if they still do). */
  partner: NationId;
}

type UnitInit = Pick<Unit, 'type' | 'owner' | 'x' | 'y'> & Partial<Unit>;

/** Creates a unit with a fresh id and adds it to the game. */
export function spawnUnit(game: Game, init: UnitInit): Unit {
  const unit: Unit = {
    id: game.nextId(), hp: 1, troops: 0, path: [], pathIndex: 0, targetTile: -1, homeId: null, destId: null,
    patrol: null, cooldown: 0, mission: 'outbound', warned: new Set(), partner: 0, ...init,
  };
  game.units.set(unit.id, unit);
  return unit;
}

/** Takes unit `id` off the map; `by` is the nation that destroyed it (0 = nobody), which emits `unitLost`. */
export function removeUnit(game: Game, id: number, by: NationId): void {
  const u = game.units.get(id);
  if (!u) return;
  game.units.delete(id);
  if (by !== 0) game.emit({ type: 'unitLost', owner: u.owner, by, unit: u.type });
}

/** Moves `u` up to `speed` tiles along its waypoints; true once the last waypoint is reached. */
export function advanceAlongPath(u: Unit, map: GameMap, speed: number): boolean {
  let budget = speed;
  while (budget > 0 && u.pathIndex < u.path.length) {
    const t = u.path[u.pathIndex];
    const dx = xOf(map, t) - u.x;
    const dy = yOf(map, t) - u.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= budget) {
      u.x += dx;
      u.y += dy;
      budget -= d;
      u.pathIndex++;
    } else {
      u.x += (dx / d) * budget;
      u.y += (dy / d) * budget;
      budget = 0;
    }
  }
  return u.pathIndex >= u.path.length;
}

/** One tick for every unit, in the order they were created. */
export function stepUnits(game: Game): void {
  spawnTradeShips(game);
  spawnTradePlanes(game);
  for (const u of [...game.units.values()]) {
    if (!game.units.has(u.id)) continue; // removed earlier this tick
    if (u.type === 'troopBoat') stepTroopBoat(game, u);
    else if (u.type === 'tradeShip') stepTradeShip(game, u);
    else if (u.type === 'warship') stepWarship(game, u);
    else stepPlane(game, u);
  }
  stepRadarWarnings(game);
  stepAntiAir(game);
}

/** Length of the polyline through `path`'s waypoints, in tiles. */
export function pathLength(map: GameMap, path: readonly TileIndex[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(xOf(map, path[i]) - xOf(map, path[i - 1]), yOf(map, path[i]) - yOf(map, path[i - 1]));
  }
  return total;
}

/** How many units of `type` nation `owner` has out. */
export function countUnits(game: Game, owner: NationId, type: UnitType): number {
  let n = 0;
  for (const u of game.units.values()) if (u.owner === owner && u.type === type) n++;
  return n;
}
