import { CONFIG } from '../../shared/config';
import type { NationId, NukeKind, TileIndex } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import { distance, inBounds, isLand, tileOf, xOf, yOf } from '../map/grid';
import { destroyBuilding } from './buildings';
import type { Building } from './buildings';
import { density } from './combat';
import { commitHostility, shieldBlock } from './protection';
import { declareWar } from './relations';
import { advanceAlongPath, removeUnit, spawnUnit } from './units';
import type { Unit } from './units';

const fail = (reason: string): CommandResult => ({ ok: false, reason });

/** One SAM may fire once per tick. Remembered per game so a volley in the same tick shares the limit. */
const samsUsed = new WeakMap<Game, { tick: number; used: Set<number> }>();

/** Marks `tile` as fallout when it is land and not already. Ownership stays; the tile stops counting toward a win. */
export function markFallout(game: Game, tile: TileIndex): void {
  if (game.fallout[tile] === 1 || !isLand(game.map, tile)) return;
  game.fallout[tile] = 1;
  game.falloutCount++;
  const owner = game.owner[tile];
  if (owner !== 0) game.nations[owner].falloutTiles++;
  game.noteFallout(tile, true);
}

/** Clears fallout on `tile` if any. */
export function clearFallout(game: Game, tile: TileIndex): void {
  if (game.fallout[tile] !== 1) return;
  game.fallout[tile] = 0;
  game.falloutCount--;
  const owner = game.owner[tile];
  if (owner !== 0) game.nations[owner].falloutTiles--;
  game.noteFallout(tile, false);
}

/** The finished silo `nation` can fire at `tile` from, the nearest one that is not reloading. */
function readySilo(game: Game, nation: NationId, tile: TileIndex): Building | 'no missile silo' | 'silo reloading' {
  let best: Building | null = null;
  let bestD = Infinity;
  let any = false;
  for (const silo of game.buildings.ofNation(nation, 'missileSilo')) {
    if (silo.ticksLeft > 0) continue;
    any = true;
    if (silo.cooldown > 0) continue;
    const d = distance(game.map, silo.tile, tile);
    if (d < bestD) {
      best = silo;
      bestD = d;
    }
  }
  if (best) return best;
  return any ? 'silo reloading' : 'no missile silo';
}

/**
 * Launches `kind` from `nation`'s nearest ready silo at `tile`. Needs a finished silo, the gold, and a land tile that
 * isn't the nation's own or an ally's or still spawn-shielded. A MIRV is three warheads. Firing on a nation declares
 * war and ends the attacker's spawn shield.
 */
export function launchNuke(game: Game, nation: NationId, tile: TileIndex, kind: NukeKind): CommandResult {
  const { map } = game;
  if (!Number.isInteger(tile) || tile < 0 || tile >= map.width * map.height) return fail('off the map');
  if (!isLand(map, tile)) return fail('not land');
  const owner = game.owner[tile];
  if (owner === nation) return fail('own tile');
  if (owner !== 0 && game.relations.get(nation, owner) === 'allied') return fail('allied');
  const blocked = shieldBlock(game, owner);
  if (blocked) return fail(blocked);
  const spec = CONFIG.nukes[kind];
  const silo = readySilo(game, nation, tile);
  if (typeof silo === 'string') return fail(silo);
  const n = game.nations[nation];
  if (n.gold < spec.cost) return fail('not enough gold');
  n.gold -= spec.cost;
  silo.cooldown = CONFIG.nukes.cooldownTicks;
  if (owner !== 0) {
    commitHostility(game, nation, owner);
    declareWar(game, nation, owner);
  }
  const sx = xOf(map, silo.tile);
  const sy = yOf(map, silo.tile);
  for (const aim of warheadTargets(game, tile, kind)) {
    spawnUnit(game, {
      type: 'missile', owner: nation, x: sx, y: sy, hp: 1, path: [aim], targetTile: aim,
      speed: spec.speed, payload: { kind, radius: spec.radius },
    });
  }
  return { ok: true };
}

/** Where the warheads of `kind` aimed at `tile` come down. Off-map or water offsets fall back to `tile`. */
function warheadTargets(game: Game, tile: TileIndex, kind: NukeKind): TileIndex[] {
  const { map } = game;
  const cx = xOf(map, tile);
  const cy = yOf(map, tile);
  const offsets: [number, number][] = [[0, 0]];
  if (kind === 'mirv') {
    const spread = CONFIG.nukes.mirv.spread;
    offsets.push([spread, 0], [-Math.floor(spread / 2), spread]);
  }
  const aims: TileIndex[] = [];
  for (const [dx, dy] of offsets) {
    const x = cx + dx;
    const y = cy + dy;
    const aim = inBounds(map, x, y) ? tileOf(map, x, y) : tile;
    aims.push(isLand(map, aim) ? aim : tile);
  }
  return aims;
}

/** Each finished silo's reload ticks down by one, then every missile in the air moves. */
export function stepSilos(game: Game): void {
  for (const b of game.buildings.byId.values()) {
    if (b.type === 'missileSilo' && b.cooldown > 0) b.cooldown--;
  }
}

/** Moves every missile. Called after the other units so a SAM sees them where they are this tick. */
export function stepMissiles(game: Game): void {
  for (const u of [...game.units.values()]) {
    if (u.type === 'missile') stepMissile(game, u);
  }
}

/**
 * Flies `u` toward its target. A hostile SAM in range shoots one missile down per tick. Anything that arrives
 * detonates.
 */
export function stepMissile(game: Game, u: Unit): void {
  if (!game.units.has(u.id) || !u.payload) return;
  const arrived = advanceAlongPath(u, game.map, u.speed > 0 ? u.speed : CONFIG.nukes[u.payload.kind].speed);
  if (!game.units.has(u.id)) return;
  if (intercept(game, u)) return;
  if (arrived) detonate(game, u);
}

/** The nearest ready hostile SAM in range of `u`, which then cannot fire again this tick. */
function intercept(game: Game, u: Unit): boolean {
  let state = samsUsed.get(game);
  if (!state || state.tick !== game.tick) {
    state = { tick: game.tick, used: new Set() };
    samsUsed.set(game, state);
  }
  const radius = CONFIG.buildings.samLauncher.radius;
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of game.buildings.byId.values()) {
    if (b.type !== 'samLauncher' || b.ticksLeft > 0 || state.used.has(b.id)) continue;
    if (b.owner === u.owner || game.relations.get(b.owner, u.owner) === 'allied') continue;
    const d = Math.hypot(u.x - xOf(game.map, b.tile), u.y - yOf(game.map, b.tile));
    if (d <= radius && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  if (!best) return false;
  state.used.add(best.id);
  removeUnit(game, u.id, best.owner);
  game.emit({ type: 'nukeIntercepted', by: best.owner, owner: u.owner, tile: best.tile });
  return true;
}

/** Fallout, ruined buildings and troop losses in a disk around the warhead's target. */
function detonate(game: Game, u: Unit): void {
  const payload = u.payload;
  if (!payload) return;
  removeUnit(game, u.id, 0);
  const { map } = game;
  const cx = xOf(map, u.targetTile);
  const cy = yOf(map, u.targetTile);
  const r2 = payload.radius * payload.radius;
  const hits = new Map<NationId, number>();
  const doomed: number[] = [];
  for (let dy = -payload.radius; dy <= payload.radius; dy++) {
    for (let dx = -payload.radius; dx <= payload.radius; dx++) {
      if (dx * dx + dy * dy > r2 || !inBounds(map, cx + dx, cy + dy)) continue;
      const t = tileOf(map, cx + dx, cy + dy);
      if (!isLand(map, t)) continue;
      markFallout(game, t);
      const building = game.buildings.at(t);
      if (building) doomed.push(building.id);
      const owner = game.owner[t];
      hits.set(owner, (hits.get(owner) ?? 0) + 1);
    }
  }
  for (const id of doomed) destroyBuilding(game, id, u.owner);
  for (const [owner, tiles] of hits) {
    if (owner === 0) continue;
    const nation = game.nations[owner];
    const loss = Math.min(nation.troops, tiles * density(nation));
    nation.troops -= loss;
    game.emit({ type: 'nuked', by: u.owner, owner, tile: u.targetTile, kind: payload.kind });
  }
  if (![...hits.keys()].some((id) => id !== 0)) {
    game.emit({ type: 'nuked', by: u.owner, owner: 0, tile: u.targetTile, kind: payload.kind });
  }
}

/**
 * Scrubs `nation`'s fallout inside `cleanRadius` of `tile`, nearest first, at `cleanCost` gold a tile. The tile itself
 * must be the nation's own fallout.
 */
export function cleanFallout(game: Game, nation: NationId, tile: TileIndex): CommandResult {
  const { map } = game;
  if (!Number.isInteger(tile) || tile < 0 || tile >= map.width * map.height) return fail('off the map');
  if (game.owner[tile] !== nation || game.fallout[tile] !== 1) return fail('no fallout');
  const radius = CONFIG.nukes.cleanRadius;
  const cx = xOf(map, tile);
  const cy = yOf(map, tile);
  const spots: { t: TileIndex; d: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius || !inBounds(map, cx + dx, cy + dy)) continue;
      const t = tileOf(map, cx + dx, cy + dy);
      if (game.owner[t] === nation && game.fallout[t] === 1) spots.push({ t, d: dx * dx + dy * dy });
    }
  }
  spots.sort((a, b) => a.d - b.d || a.t - b.t);
  const cost = CONFIG.nukes.cleanCost;
  const n = game.nations[nation];
  if (n.gold < cost) return fail('not enough gold');
  let cleaned = 0;
  for (const spot of spots) {
    if (n.gold < cost) break;
    n.gold -= cost;
    clearFallout(game, spot.t);
    cleaned++;
  }
  return cleaned > 0 ? { ok: true } : fail('no fallout');
}
