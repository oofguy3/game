import { CONFIG } from '../../shared/config';
import type { Command, NationId, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import type { GameMap } from '../map/gameMap';
import { distance, forEachNeighbor, tileOf } from '../map/grid';
import { boatCap } from '../systems/naval';
import { countUnits } from '../systems/units';
import type { Unit } from '../systems/units';
import type { Bot } from './bot';
import { attackBudget } from './military';
import type { Perception } from './perception';

/** Coastal land tiles touching each water body, computed once per map. */
const coastCache = new WeakMap<GameMap, Map<number, TileIndex[]>>();

function coastsByBody(map: GameMap): Map<number, TileIndex[]> {
  let index = coastCache.get(map);
  if (index) return index;
  index = new Map();
  for (let t = 0; t < map.terrain.length; t++) {
    if (map.coastal[t] === 0) continue;
    const seen = new Set<number>();
    forEachNeighbor(map, t, (n) => {
      const body = map.waterBody[n];
      if (body < 0 || seen.has(body)) return;
      seen.add(body);
      let list = index!.get(body);
      if (!list) index!.set(body, (list = []));
      list.push(t);
    });
  }
  coastCache.set(map, index);
  return index;
}

/**
 * A sea invasion, when there is nothing to take over land (no free land touches us and no land attack is worth it):
 * a boat with the troop budget to the best overseas target — free land or a nation not allied with us on another
 * landmass, reached over a water body our coast touches — scored like land targets and discounted by distance.
 * Null when there's no budget, no boat to spare, or no target.
 */
export function chooseInvasion(game: Game, p: Perception, bot: Bot): Command | null {
  const targets = overseasTargets(game, p.me);
  bot.memory.overseasTargets = targets.length > 0;
  if (p.neutralBorder > 0 || targets.length === 0) return null;
  const budget = attackBudget(p, bot.profile);
  if (budget < 1 || countUnits(game, p.me, 'troopBoat') >= boatCap(game, game.nations[p.me])) return null;

  const { neutralCost, baseCost, densityFactor, minAttackRatio } = CONFIG.combat;
  const ai = CONFIG.ai;
  let best: { tile: TileIndex; score: number } | null = null;
  for (const t of targets) {
    let score: number;
    if (t.owner === 0) score = ai.neutralBias / neutralCost;
    else {
      const n = game.nations[t.owner];
      const d = n.troops / Math.max(1, n.tiles);
      score = bot.weights.aggression / (baseCost + d * densityFactor);
      if (game.relations.get(p.me, t.owner) !== 'war' && p.wars.length > 0) score *= ai.secondFrontPenalty;
    }
    score /= 1 + t.distance / ai.invasionDistanceScale;
    score *= 1 + bot.profile.noise * (bot.rng.next() * 2 - 1);
    if (score >= ai.minAttackScore && (best === null || score > best.score)) best = { tile: t.tile, score };
  }
  if (best === null) return null;
  return { type: 'boat', nation: p.me, tile: best.tile, ratio: Math.min(1, Math.max(minAttackRatio, budget / p.troops)) };
}

/** Per overseas owner (0 = free land) not allied with us: its coastal tile nearest our coast, and how far. */
function overseasTargets(game: Game, me: NationId): { owner: NationId; tile: TileIndex; distance: number }[] {
  const { map } = game;
  const mine = new Set<number>();
  const bodies = new Set<number>();
  const shore: TileIndex[] = [];
  for (const b of game.nations[me].border) {
    mine.add(map.landmass[b]);
    if (map.coastal[b] === 0) continue;
    if (shore.length < CONFIG.ai.borderSamples) shore.push(b);
    forEachNeighbor(map, b, (n) => {
      if (map.waterBody[n] >= 0) bodies.add(map.waterBody[n]);
    });
  }
  if (shore.length === 0) return [];
  const index = coastsByBody(map);
  const best = new Map<NationId, { owner: NationId; tile: TileIndex; distance: number }>();
  for (const body of bodies) {
    const coast = index.get(body) ?? [];
    const step = Math.max(1, Math.floor(coast.length / CONFIG.ai.invasionCoastSamples));
    for (let i = 0; i < coast.length; i += step) {
      const t = coast[i];
      const owner = game.owner[t];
      if (owner === me || mine.has(map.landmass[t])) continue;
      if (owner !== 0 && (!game.nations[owner].alive || game.relations.get(me, owner) === 'allied')) continue;
      let d = Infinity;
      for (const s of shore) d = Math.min(d, distance(map, s, t));
      const prev = best.get(owner);
      if (!prev || d < prev.distance) best.set(owner, { owner, tile: t, distance: d });
    }
  }
  return [...best.values()].sort((a, b) => a.owner - b.owner);
}

/**
 * Warship decisions: note any enemy troop boat heading for our land as a naval threat; while the threat is recent,
 * build warships at our naval base (up to `warshipsPerBase` each); send idle warships after the nearest such boat.
 */
export function manageWarships(game: Game, p: Perception, bot: Bot): Command[] {
  const { map } = game;
  const threats: Unit[] = [];
  const mineIdle: Unit[] = [];
  let warships = 0;
  for (const u of game.units.values()) {
    if (u.owner === p.me) {
      if (u.type === 'warship') {
        warships++;
        if (u.pathIndex >= u.path.length) mineIdle.push(u);
      }
    } else if (u.type === 'troopBoat' && u.targetTile >= 0 && game.owner[u.targetTile] === p.me) threats.push(u);
  }
  if (threats.length > 0) bot.memory.lastNavalThreatTick = game.tick;
  const commands: Command[] = [];

  if (game.tick - bot.memory.lastNavalThreatTick <= CONFIG.ai.navalThreatTicks) {
    const bases = game.buildings.ofNation(p.me, 'navalBase').filter((b) => b.ticksLeft === 0);
    if (bases.length > 0 && warships < bases.length * CONFIG.ai.warshipsPerBase && p.gold >= CONFIG.units.warship.cost) {
      commands.push({ type: 'buildUnit', nation: p.me, unit: 'warship', buildingId: bases[0].id });
    }
  }
  for (const ship of mineIdle) {
    const body = ship.patrol === null ? -1 : map.waterBody[ship.patrol];
    let nearest: Unit | null = null;
    let nearestD = Infinity;
    for (const boat of threats) {
      const t = tileOf(map, Math.round(boat.x), Math.round(boat.y));
      if (map.waterBody[t] !== body) continue;
      const d = Math.hypot(boat.x - ship.x, boat.y - ship.y);
      if (d < nearestD) {
        nearest = boat;
        nearestD = d;
      }
    }
    if (nearest) {
      commands.push({ type: 'moveUnit', nation: p.me, unitId: ship.id, tile: tileOf(map, Math.round(nearest.x), Math.round(nearest.y)) });
    }
  }
  return commands;
}
