import { CONFIG } from '../../shared/config';
import { BUILDING_TYPES } from '../../shared/types';
import type { NationId, TileIndex, UnitType } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import { scaledTicks } from '../core/tuning';
import { distance, isLand, tileOf, xOf, yOf } from '../map/grid';
import { landTroops } from './attacks';
import { buildingsInRadius, destroyBuilding } from './buildings';
import type { Building } from './buildings';
import { density } from './combat';
import { payTrade } from './naval';
import { canTrade, declareWar } from './relations';
import { advanceAlongPath, removeUnit, spawnUnit } from './units';
import type { Unit } from './units';

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const PLANES = new Set<UnitType>(['tradePlane', 'bomber', 'paraPlane', 'fighter']);
/** A fighter fires at planes within this many tiles. */
const GUN_RANGE = 2;

/** `nation`'s nearest active airport within range of `tile` that is ready for a mission; null if none. */
export function airportInRange(game: Game, nation: NationId, tile: TileIndex): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const a of game.buildings.ofNation(nation, 'airport')) {
    if (a.ticksLeft > 0 || a.cooldown > 0) continue;
    const d = distance(game.map, a.tile, tile);
    if (d <= CONFIG.buildings.airport.range && d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** The airport for a mission to `tile`, or the reason there is none: no airport, all too far, or all busy. */
function missionAirport(game: Game, nation: NationId, tile: TileIndex): Building | string {
  const ready = airportInRange(game, nation, tile);
  if (ready) return ready;
  const active = game.buildings.ofNation(nation, 'airport').filter((a) => a.ticksLeft === 0);
  if (active.length === 0) return 'no airport';
  const inRange = active.some((a) => distance(game.map, a.tile, tile) <= CONFIG.buildings.airport.range);
  return inRange ? 'airport busy' : 'out of range';
}

function onMap(game: Game, tile: TileIndex): boolean {
  return Number.isInteger(tile) && tile >= 0 && tile < game.map.width * game.map.height;
}

/**
 * Sends a bomber from `nation`'s nearest ready airport in range against the nation owning `tile`, for `bomber.cost`
 * gold. It declares war; the airport rests for `bomber.cooldownTicks`.
 */
export function launchBomber(game: Game, nation: NationId, tile: TileIndex): CommandResult {
  if (!onMap(game, tile)) return fail('off the map');
  const owner = game.owner[tile];
  if (owner === nation) return fail('own tile');
  if (owner === 0) return fail('nobody owns that');
  if (game.relations.get(nation, owner) === 'allied') return fail('allied');
  const airport = missionAirport(game, nation, tile);
  if (typeof airport === 'string') return fail(airport);
  const { cost, cooldownTicks, hp } = CONFIG.units.bomber;
  const n = game.nations[nation];
  if (n.gold < cost) return fail('not enough gold');
  n.gold -= cost;
  airport.cooldown = cooldownTicks;
  declareWar(game, nation, owner);
  launch(game, 'bomber', nation, airport, tile, { hp });
  return { ok: true };
}

/**
 * Drops paratroopers on `tile` (land that isn't ours or an ally's) from `nation`'s nearest ready airport in range:
 * floor(min(ratio, `maxTroopsShare`) × troops) jump, for `paraPlane.cost` gold. Landing starts an attack from there.
 */
export function launchParatroopers(game: Game, nation: NationId, tile: TileIndex, ratio: number): CommandResult {
  if (!onMap(game, tile)) return fail('off the map');
  if (!isLand(game.map, tile)) return fail('not land');
  const owner = game.owner[tile];
  if (owner === nation) return fail('own tile');
  if (owner !== 0 && game.relations.get(nation, owner) === 'allied') return fail('allied');
  const airport = missionAirport(game, nation, tile);
  if (typeof airport === 'string') return fail(airport);
  const { cost, cooldownTicks, hp, maxTroopsShare } = CONFIG.units.paraPlane;
  const n = game.nations[nation];
  if (n.gold < cost) return fail('not enough gold');
  const troops = Math.floor(Math.min(Number.isFinite(ratio) ? ratio : 0, maxTroopsShare) * n.troops);
  if (troops < 1) return fail('not enough troops');
  n.gold -= cost;
  n.troops -= troops;
  airport.cooldown = cooldownTicks;
  if (owner !== 0) declareWar(game, nation, owner);
  launch(game, 'paraPlane', nation, airport, tile, { hp, troops });
  return { ok: true };
}

/**
 * Builds a fighter at `nation`'s finished airport `airportId` for `fighter.cost`; it guards that airport's sky once
 * ready, after `fighter.buildTicks` scaled by the rules' build time scale.
 */
export function buildFighter(game: Game, nation: NationId, airportId: number): CommandResult {
  const airport = game.buildings.byId.get(airportId);
  if (!airport || airport.owner !== nation || airport.type !== 'airport') return fail('not your airport');
  if (airport.ticksLeft > 0) return fail('still being built');
  const { cost, buildTicks, hp } = CONFIG.units.fighter;
  const n = game.nations[nation];
  if (n.gold < cost) return fail('not enough gold');
  n.gold -= cost;
  spawnUnit(game, {
    type: 'fighter', owner: nation, x: xOf(game.map, airport.tile), y: yOf(game.map, airport.tile), hp,
    cooldown: scaledTicks(buildTicks, game.tuning.buildTimeScale), patrol: airport.tile, mission: 'patrol',
    homeId: airport.id,
  });
  return { ok: true };
}

function launch(game: Game, type: UnitType, owner: NationId, airport: Building, target: TileIndex, extra: { hp: number; troops?: number }): void {
  spawnUnit(game, {
    type, owner, x: xOf(game.map, airport.tile), y: yOf(game.map, airport.tile), path: [target], targetTile: target,
    homeId: airport.id, mission: 'outbound', ...extra,
  });
}

/**
 * Airport timers: missions rest down, and each active airport whose trade timer runs out sends a trade plane to a
 * random other nation's airport it may trade with (any distance), then waits `tradeEveryTicks`.
 */
export function spawnTradePlanes(game: Game): void {
  let airports: Building[] | null = null;
  for (const a of game.buildings.byId.values()) {
    if (a.type !== 'airport' || a.ticksLeft > 0) continue;
    if (a.cooldown > 0) a.cooldown--;
    if ((a.tradeTimer ?? 0) > 0) {
      a.tradeTimer = (a.tradeTimer ?? 0) - 1;
      continue;
    }
    a.tradeTimer = CONFIG.buildings.airport.tradeEveryTicks;
    airports ??= [...game.buildings.byId.values()].filter((b) => b.type === 'airport' && b.ticksLeft === 0);
    const partners = airports.filter((b) => b.owner !== a.owner && canTrade(game, a.owner, b.owner));
    if (partners.length === 0) continue;
    const dest = partners[Math.floor(game.rng.next() * partners.length)];
    spawnUnit(game, {
      type: 'tradePlane', owner: a.owner, x: xOf(game.map, a.tile), y: yOf(game.map, a.tile), path: [dest.tile],
      targetTile: dest.tile, homeId: a.id, destId: dest.id, partner: dest.owner, hp: 1,
    });
  }
}

/** One tick of a plane, by type. */
export function stepPlane(game: Game, u: Unit): void {
  if (u.type === 'fighter') stepFighter(game, u);
  else if (u.type === 'tradePlane') stepTradePlane(game, u);
  else if (u.type === 'paraPlane') stepParaPlane(game, u);
  else if (u.type === 'bomber') stepBomber(game, u);
}

function homeAirport(game: Game, u: Unit): Building | null {
  const home = u.homeId === null ? undefined : game.buildings.byId.get(u.homeId);
  return home && home.owner === u.owner && home.type === 'airport' ? home : null;
}

function stepBomber(game: Game, u: Unit): void {
  const { speed, radius, killFactor } = CONFIG.units.bomber;
  if (!advanceAlongPath(u, game.map, speed)) {
    if (u.mission === 'returning' && homeAirport(game, u) === null) removeUnit(game, u.id, 0);
    return;
  }
  if (u.mission === 'returning') {
    removeUnit(game, u.id, 0);
    return;
  }
  bomb(game, u.owner, u.targetTile, radius, killFactor);
  const home = homeAirport(game, u);
  if (home === null) {
    removeUnit(game, u.id, 0);
    return;
  }
  u.mission = 'returning';
  u.path = [home.tile];
  u.pathIndex = 0;
}

/**
 * Destroys the target owner's buildings within `radius` of `tile` and kills troops for every tile of theirs there, and
 * emits `bombed`; nothing when the tile has since become ours, an ally's or no one's.
 */
function bomb(game: Game, by: NationId, tile: TileIndex, radius: number, killFactor: number): void {
  const owner = game.owner[tile];
  if (owner === 0 || owner === by || game.relations.get(by, owner) === 'allied') return;
  game.emit({ type: 'bombed', by, owner, tile });
  for (const b of buildingsInRadius(game, owner, BUILDING_TYPES, tile, radius)) destroyBuilding(game, b.id, by);
  const { map } = game;
  const cx = xOf(map, tile);
  const cy = yOf(map, tile);
  let hit = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (dx * dx + dy * dy > radius * radius || x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (game.owner[tileOf(map, x, y)] === owner) hit++;
    }
  }
  const target = game.nations[owner];
  target.troops -= Math.min(target.troops, density(target) * hit * killFactor);
}

function stepParaPlane(game: Game, u: Unit): void {
  if (!advanceAlongPath(u, game.map, CONFIG.units.paraPlane.speed)) return;
  removeUnit(game, u.id, 0);
  landTroops(game, u.owner, u.targetTile, u.troops, true);
}

function stepTradePlane(game: Game, u: Unit): void {
  if (!advanceAlongPath(u, game.map, CONFIG.units.tradePlane.speed)) return;
  removeUnit(game, u.id, 0);
  const dest = u.destId === null ? undefined : game.buildings.byId.get(u.destId);
  if (!dest || dest.owner !== u.partner || !game.nations[u.owner].alive || !game.nations[u.partner].alive) return;
  if (!canTrade(game, u.owner, u.partner)) return;
  const { goldBase, goldPerTile } = CONFIG.units.tradePlane;
  const start = u.homeId === null ? undefined : game.buildings.byId.get(u.homeId);
  const length = start ? distance(game.map, start.tile, dest.tile) : distance(game.map, u.targetTile, dest.tile);
  const gold = goldBase + goldPerTile * length;
  payTrade(game, u.owner, u.partner, gold);
  payTrade(game, u.partner, u.owner, gold);
}

/**
 * A fighter guards its airport's sky: it chases the nearest plane of a nation at war with its owner within `detect`
 * tiles (scaled by radar, Task 22), firing with `hitChance` per tick once within `GUN_RANGE`; otherwise it circles
 * within `range` of its airport. It goes when its airport does.
 */
function stepFighter(game: Game, u: Unit): void {
  const { speed, range, detect, hitChance } = CONFIG.units.fighter;
  const home = homeAirport(game, u);
  if (home === null) {
    removeUnit(game, u.id, 0);
    return;
  }
  if (u.cooldown > 0) {
    u.cooldown--;
    return;
  }
  const { map } = game;
  const hx = xOf(map, home.tile);
  const hy = yOf(map, home.tile);
  const reach = detect * radarBoost(game, u.owner, u.x, u.y);
  let target: Unit | null = null;
  let best = reach;
  for (const other of game.units.values()) {
    if (other === u || !PLANES.has(other.type) || game.relations.get(u.owner, other.owner) !== 'war') continue;
    if (Math.hypot(other.x - hx, other.y - hy) > range + reach) continue;
    const d = Math.hypot(other.x - u.x, other.y - u.y);
    if (d <= best) {
      best = d;
      target = other;
    }
  }
  if (target) {
    moveTowards(u, target.x, target.y, speed);
    if (Math.hypot(target.x - u.x, target.y - u.y) <= GUN_RANGE && game.rng.chance(hitChance)) {
      target.hp -= 1;
      if (target.hp <= 0) removeUnit(game, target.id, u.owner);
    }
    return;
  }
  // circle the airport
  if (u.pathIndex >= u.path.length) {
    const angle = game.rng.next() * Math.PI * 2;
    const r = (range / 2) * game.rng.next();
    const x = Math.max(0, Math.min(map.width - 1, Math.round(hx + Math.cos(angle) * r)));
    const y = Math.max(0, Math.min(map.height - 1, Math.round(hy + Math.sin(angle) * r)));
    u.path = [tileOf(map, x, y)];
    u.pathIndex = 0;
  }
  advanceAlongPath(u, map, speed);
}

function moveTowards(u: Unit, x: number, y: number, speed: number): void {
  const dx = x - u.x;
  const dy = y - u.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed) {
    u.x = x;
    u.y = y;
  } else {
    u.x += (dx / d) * speed;
    u.y += (dy / d) * speed;
  }
}

/** How much radar coverage sharpens `owner`'s air defense at (x, y): `radar.boost` within an active radar's radius, else 1. */
export function radarBoost(game: Game, owner: NationId, x: number, y: number): number {
  const { radius, boost } = CONFIG.buildings.radar;
  for (const r of game.buildings.ofNation(owner, 'radar')) {
    if (r.ticksLeft === 0 && Math.hypot(xOf(game.map, r.tile) - x, yOf(game.map, r.tile) - y) <= radius) return boost;
  }
  return 1;
}

/**
 * Every active anti-air gun fires at each plane within its radius whose owner is at war with the gun's: 1 damage with
 * `hitChance` × the radar boost at the plane. Trade planes too.
 */
export function stepAntiAir(game: Game): void {
  const { radius, hitChance } = CONFIG.buildings.antiAir;
  for (const gun of game.buildings.byId.values()) {
    if (gun.type !== 'antiAir' || gun.ticksLeft > 0) continue;
    const gx = xOf(game.map, gun.tile);
    const gy = yOf(game.map, gun.tile);
    for (const u of [...game.units.values()]) {
      if (!PLANES.has(u.type) || !game.units.has(u.id) || game.relations.get(gun.owner, u.owner) !== 'war') continue;
      if (Math.hypot(u.x - gx, u.y - gy) > radius) continue;
      if (!game.rng.chance(hitChance * radarBoost(game, gun.owner, u.x, u.y))) continue;
      u.hp -= 1;
      if (u.hp <= 0) removeUnit(game, u.id, gun.owner);
    }
  }
}

/** A foreign, non-allied bomber or paratroop plane inside one of a nation's active radars warns it, once per plane. */
export function stepRadarWarnings(game: Game): void {
  const { radius } = CONFIG.buildings.radar;
  for (const u of game.units.values()) {
    if (u.type !== 'bomber' && u.type !== 'paraPlane') continue;
    for (const r of game.buildings.byId.values()) {
      if (r.type !== 'radar' || r.ticksLeft > 0 || r.owner === u.owner || u.warned.has(r.owner)) continue;
      if (game.relations.get(r.owner, u.owner) === 'allied') continue;
      if (Math.hypot(u.x - xOf(game.map, r.tile), u.y - yOf(game.map, r.tile)) > radius) continue;
      u.warned.add(r.owner);
      const tile = tileOf(game.map, Math.round(u.x), Math.round(u.y));
      game.emit({ type: 'radarWarning', nation: r.owner, from: u.owner, unit: u.type, tile });
    }
  }
}
