import { CONFIG } from '../../shared/config';
import type { NationId, TileIndex } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import type { Nation } from '../core/nation';
import { distance, forEachNeighbor, isLand, tileOf, xOf, yOf } from '../map/grid';
import { adjacentWater, findWaterPath } from '../map/waterNav';
import { landTroops } from './attacks';
import type { Building } from './buildings';
import { tradeMultiplier } from './economy';
import { canTrade, declareWar } from './relations';
import { advanceAlongPath, countUnits, pathLength, removeUnit, spawnUnit } from './units';
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

/**
 * Each active port whose cooldown has run out sends a trade ship to another nation's port on the same water body, if
 * the two may trade: picked at random from the candidates, weighting those `preferredMin`–`preferredMax` tiles away
 * fully and the rest by `offRangeWeight`. The cooldown then restarts at `tradeEveryTicks`.
 */
export function spawnTradeShips(game: Game): void {
  const { map } = game;
  const ship = CONFIG.units.tradeShip;
  let ports: Building[] | null = null;
  for (const port of game.buildings.byId.values()) {
    if (port.type !== 'port' || port.ticksLeft > 0) continue;
    if (port.cooldown > 0) {
      port.cooldown--;
      continue;
    }
    port.cooldown = CONFIG.buildings.port.tradeEveryTicks;
    const body = portBody(game, port);
    if (body < 0) continue;
    ports ??= [...game.buildings.byId.values()].filter((b) => b.type === 'port' && b.ticksLeft === 0);
    const partners: { port: Building; weight: number }[] = [];
    let total = 0;
    for (const other of ports) {
      if (other.owner === port.owner || !canTrade(game, port.owner, other.owner) || portBody(game, other) !== body) continue;
      const d = distance(map, port.tile, other.tile);
      const weight = d >= ship.preferredMin && d <= ship.preferredMax ? 1 : ship.offRangeWeight;
      partners.push({ port: other, weight });
      total += weight;
    }
    if (partners.length === 0) continue;
    let pick = game.rng.next() * total;
    let dest = partners[partners.length - 1].port;
    for (const p of partners) {
      pick -= p.weight;
      if (pick < 0) {
        dest = p.port;
        break;
      }
    }
    const from = adjacentWater(map, port.tile, body);
    const to = adjacentWater(map, dest.tile, body);
    if (from === null || to === null) continue;
    const path = findWaterPath(map, game.nav, from, to);
    if (path === null) continue;
    spawnUnit(game, {
      type: 'tradeShip', owner: port.owner, x: xOf(map, from), y: yOf(map, from), path, targetTile: dest.tile,
      homeId: port.id, destId: dest.id, partner: dest.owner,
    });
  }
}

/**
 * One tick of a trade ship. On arrival it pays both its owner and the destination's owner
 * `goldBase` + `goldPerTile` × the route length, each times their trade multiplier — provided the destination port
 * still stands, still belongs to the same nation, and the two may still trade. Otherwise it just goes.
 */
export function stepTradeShip(game: Game, u: Unit): void {
  if (!advanceAlongPath(u, game.map, CONFIG.units.tradeShip.speed)) return;
  removeUnit(game, u.id, 0);
  const dest = u.destId === null ? undefined : game.buildings.byId.get(u.destId);
  const owner = game.nations[u.owner];
  const partner = game.nations[u.partner];
  if (!dest || dest.owner !== u.partner || !owner.alive || !partner.alive || !canTrade(game, u.owner, u.partner)) return;
  const { goldBase, goldPerTile } = CONFIG.units.tradeShip;
  const gold = goldBase + goldPerTile * pathLength(game.map, u.path);
  payTrade(game, u.owner, u.partner, gold);
  payTrade(game, u.partner, u.owner, gold);
}

/** Pays `nation` its share of a trade with `partner` worth `gold`, after its trade multiplier. */
export function payTrade(game: Game, nation: NationId, partner: NationId, gold: number): void {
  const n = game.nations[nation];
  const paid = gold * tradeMultiplier(game, n);
  n.gold += paid;
  n.stats.goldEarned += paid;
  n.tradeIncome += paid * (1 - CONFIG.gold.tradeIncomeDecay);
  game.emit({ type: 'trade', nation, partner, gold: paid });
}

/**
 * Builds a warship at `nation`'s finished naval base `navalBaseId` for `warship.cost` gold. It launches on the
 * neighbouring water, patrolling there, and can't fight for `warship.buildTicks` while it is fitted out.
 */
export function buildWarship(game: Game, nation: NationId, navalBaseId: number): CommandResult {
  const base = game.buildings.byId.get(navalBaseId);
  if (!base || base.owner !== nation || base.type !== 'navalBase') return fail('not your naval base');
  if (base.ticksLeft > 0) return fail('still being built');
  const { cost, buildTicks, hp } = CONFIG.units.warship;
  const n = game.nations[nation];
  if (n.gold < cost) return fail('not enough gold');
  const body = portBody(game, base);
  const water = body < 0 ? null : adjacentWater(game.map, base.tile, body);
  if (water === null) return fail('no water');
  n.gold -= cost;
  spawnUnit(game, {
    type: 'warship', owner: nation, x: xOf(game.map, water), y: yOf(game.map, water), hp, cooldown: buildTicks,
    patrol: water, mission: 'patrol', homeId: base.id,
  });
  return { ok: true };
}

/** Sends `nation`'s warship `unitId` to patrol around `tile`, which must be water on the warship's own sea. */
export function moveWarship(game: Game, nation: NationId, unitId: number, tile: TileIndex): CommandResult {
  const { map } = game;
  const u = game.units.get(unitId);
  if (!u || u.owner !== nation || u.type !== 'warship') return fail('not your warship');
  if (!Number.isInteger(tile) || tile < 0 || tile >= map.width * map.height) return fail('off the map');
  if (map.waterBody[tile] < 0) return fail('not water');
  const here = u.patrol ?? nearestWater(game, u);
  if (here === null || map.waterBody[here] !== map.waterBody[tile]) return fail('different sea');
  const start = nearestWater(game, u) ?? here;
  u.path = map.waterBody[start] === map.waterBody[tile] ? findWaterPath(map, game.nav, start, tile) ?? [tile] : [tile];
  u.pathIndex = 0;
  u.patrol = tile;
  return { ok: true };
}

/**
 * One tick of a warship: sail to its patrol point, then cruise within `patrolRadius` of it; once fitted out, fire at
 * the nearest ship within `range` whose owner is at war with ours, hitting with `hitChance` for 1 damage. A ship at
 * 0 hp sinks (with any troops aboard).
 */
export function stepWarship(game: Game, u: Unit): void {
  const { speed, range, hitChance, patrolRadius } = CONFIG.units.warship;
  const { map } = game;
  if (advanceAlongPath(u, map, speed) && u.patrol !== null) {
    // arrived: pick a new spot to cruise to near the patrol point
    const px = xOf(map, u.patrol);
    const py = yOf(map, u.patrol);
    const r = patrolRadius / 3;
    const x = Math.round(px + (game.rng.next() * 2 - 1) * r);
    const y = Math.round(py + (game.rng.next() * 2 - 1) * r);
    if (x >= 0 && y >= 0 && x < map.width && y < map.height) {
      const t = tileOf(map, x, y);
      if (map.waterBody[t] === map.waterBody[u.patrol]) {
        u.path = [t];
        u.pathIndex = 0;
      }
    }
  }
  if (u.cooldown > 0) {
    u.cooldown--;
    return;
  }
  let target: Unit | null = null;
  let best: number = range;
  for (const other of game.units.values()) {
    if (other === u || !SHIPS.has(other.type) || game.relations.get(u.owner, other.owner) !== 'war') continue;
    const d = Math.hypot(other.x - u.x, other.y - u.y);
    if (d <= best) {
      best = d;
      target = other;
    }
  }
  if (target === null || !game.rng.chance(hitChance)) return;
  target.hp -= 1;
  if (target.hp <= 0) removeUnit(game, target.id, u.owner);
}

const SHIPS = new Set(['troopBoat', 'tradeShip', 'warship']);

/** The biggest water body touching a coastal building's tile; -1 if none. */
function portBody(game: Game, b: Building): number {
  const { map } = game;
  let body = -1;
  forEachNeighbor(map, b.tile, (t) => {
    const w = map.waterBody[t];
    if (w >= 0 && (body < 0 || map.waterBodySize[w] > map.waterBodySize[body])) body = w;
  });
  return body;
}

/** The water tile under a unit, or the nearest water next to it; null if none. */
function nearestWater(game: Game, u: Unit): TileIndex | null {
  const { map } = game;
  const t = tileOf(map, Math.max(0, Math.min(map.width - 1, Math.round(u.x))), Math.max(0, Math.min(map.height - 1, Math.round(u.y))));
  if (map.waterBody[t] >= 0) return t;
  return adjacentWater(map, t);
}
