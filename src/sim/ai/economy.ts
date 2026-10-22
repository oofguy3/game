import { CONFIG } from '../../shared/config';
import { BUILDING_TYPES } from '../../shared/types';
import type { BuildingType, Command, NationId, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { distance, forEachNeighbor, inBounds, isLand, tileOf, xOf, yOf } from '../map/grid';
import { buildingCost, canPlace } from '../systems/buildings';
import type { Rng } from '../util/rng';
import type { Bot } from './bot';
import type { NeighborInfo, Perception } from './perception';

export interface BuildPlan {
  type: BuildingType;
  /** Benefit per gold, weighted by personality. */
  value: number;
}

/** Gold a troop is worth to this nation right now: its income per troop of growth. */
export function troopGoldValue(p: Perception): number {
  return p.income / Math.max(1, p.growth);
}

/**
 * Every building worth building, best first, valued as benefit per gold × the matching personality weight. Per-tick
 * benefits (gold, growth) count over `buildHorizonTicks`; troops convert to gold at `troopGoldValue`. Defenses are
 * worth something only against a front threat; ports only with someone to trade with. Naval bases, airports,
 * anti-air and radar come with the sea and air tasks.
 */
export function rankBuilds(game: Game, p: Perception, bot: Bot): BuildPlan[] {
  const B = CONFIG.buildings;
  const { buildHorizonTicks: H, defenseUrgency } = CONFIG.ai;
  const w = bot.weights;
  const tgv = troopGoldValue(p);
  const threat = frontThreat(p);
  const benefit: Record<BuildingType, number> = {
    factory: B.factory.gold * H * w.economy,
    bank: (B.bank.gold + p.tradeIncome * B.bank.tradeBonus) * H * w.trade,
    city: B.city.maxTroops * tgv * w.economy,
    barracks: p.growth * B.barracks.growthBonus * tgv * H * w.economy,
    defensePost: threat * B.defensePost.multiplier * H * defenseUrgency * w.defense,
    fortress: threat * B.fortress.multiplier * H * defenseUrgency * w.defense,
    port: portBenefit(game, p, bot),
    navalBase: game.tick - bot.memory.lastNavalThreatTick <= CONFIG.ai.navalThreatTicks
      ? H * CONFIG.ai.navalUrgency * w.defense
      : 0,
    airport: 0,
    antiAir: 0,
    radar: 0,
  };
  const plans: BuildPlan[] = [];
  for (const type of BUILDING_TYPES) {
    if (benefit[type] > 0) plans.push({ type, value: benefit[type] / buildingCost(game, p.me, type) });
  }
  return plans.sort((a, b) => b.value - a.value);
}

/**
 * What this bot builds now, or null. The best plan when affordable (placed where it serves best); when the best is
 * not affordable but will be within `saveHorizonTicks` of income, nothing — it saves; otherwise the best affordable
 * plan. With probability 1 − `buildQuality` a random affordable plan instead.
 */
export function chooseBuild(game: Game, p: Perception, bot: Bot): Command | null {
  const ranked = rankBuilds(game, p, bot);
  if (ranked.length === 0) return null;
  const cost = (type: BuildingType): number => buildingCost(game, p.me, type);
  const affordable = ranked.filter((plan) => cost(plan.type) <= p.gold);

  if (affordable.length > 0 && bot.rng.chance(1 - bot.profile.buildQuality)) {
    return buildAt(game, p, bot, bot.rng.pick(affordable).type);
  }
  const best = ranked[0];
  if (cost(best.type) > p.gold && p.gold + p.income * CONFIG.ai.saveHorizonTicks >= cost(best.type)) return null;
  for (const plan of affordable) {
    const cmd = buildAt(game, p, bot, plan.type);
    if (cmd) return cmd;
  }
  return null;
}

function buildAt(game: Game, p: Perception, bot: Bot, type: BuildingType): Command | null {
  const tile = findPlacement(game, p.me, type, p, bot.rng);
  return tile === null ? null : { type: 'build', nation: p.me, building: type, tile };
}

const FRONT_TYPES: readonly BuildingType[] = ['defensePost', 'fortress'];
const COAST_TYPES: readonly BuildingType[] = ['port', 'navalBase'];

/**
 * Where `me` should put a building of `type`, or null when nowhere fits (every pick passes `canPlace`):
 * - defenses go `frontInset` tiles inland from the border with the most threatening neighbour, where their radius
 *   covers the most of that border;
 * - ports and naval bases go on the coast, on the largest water body;
 * - everything else goes deep inside: of `interiorSamples` own tiles near the centroid, the farthest from the border
 *   with other nations.
 */
export function findPlacement(game: Game, me: NationId, type: BuildingType, p: Perception, rng: Rng): TileIndex | null {
  if (FRONT_TYPES.includes(type)) return frontPlacement(game, me, type, p);
  if (COAST_TYPES.includes(type)) return coastPlacement(game, me, type);
  return interiorPlacement(game, me, type, rng);
}

function placeable(game: Game, me: NationId, type: BuildingType, tile: TileIndex): boolean {
  return canPlace(game, me, type, tile).ok;
}

function interiorPlacement(game: Game, me: NationId, type: BuildingType, rng: Rng): TileIndex | null {
  const { interiorSamples, interiorSearch } = CONFIG.ai;
  const region = ownTilesAround(game, me, centroidTile(game, me), interiorSearch);
  if (region.length === 0) return null;
  const candidates: TileIndex[] = [];
  if (region.length <= interiorSamples) candidates.push(...region);
  else for (let i = 0; i < interiorSamples; i++) candidates.push(region[rng.int(0, region.length - 1)]);

  const edge = foreignBorder(game, me);
  let best: TileIndex | null = null;
  let bestDepth = -Infinity;
  for (const t of candidates) {
    if (!placeable(game, me, type, t)) continue;
    let depth = Infinity;
    for (const e of edge) depth = Math.min(depth, distance(game.map, t, e));
    if (depth > bestDepth) {
      best = t;
      bestDepth = depth;
    }
  }
  return best;
}

function frontPlacement(game: Game, me: NationId, type: BuildingType, p: Perception): TileIndex | null {
  const enemy = mostThreatening(p);
  if (enemy === null) return null;
  const { map } = game;
  const front = borderTouching(game, me, (owner) => owner === enemy.id);
  if (front.length === 0) return null;
  const nation = game.nations[me];
  const cx = nation.sumX / Math.max(1, nation.tiles);
  const cy = nation.sumY / Math.max(1, nation.tiles);
  const inset = CONFIG.ai.frontInset;
  const radius = CONFIG.buildings[type === 'fortress' ? 'fortress' : 'defensePost'].radius;

  let best: TileIndex | null = null;
  let bestCover = -1;
  const tried = new Set<TileIndex>();
  for (const f of front) {
    const x = xOf(map, f);
    const y = yOf(map, f);
    const len = Math.hypot(cx - x, cy - y);
    const nx = len < 1 ? x : Math.round(x + ((cx - x) / len) * inset);
    const ny = len < 1 ? y : Math.round(y + ((cy - y) / len) * inset);
    if (!inBounds(map, nx, ny)) continue;
    const t = tileOf(map, nx, ny);
    if (tried.has(t)) continue;
    tried.add(t);
    if (game.owner[t] !== me || !placeable(game, me, type, t)) continue;
    let cover = 0;
    for (const g of front) if (distance(map, t, g) <= radius) cover++;
    if (cover > bestCover) {
      best = t;
      bestCover = cover;
    }
  }
  return best;
}

function coastPlacement(game: Game, me: NationId, type: BuildingType): TileIndex | null {
  const { map } = game;
  let best: TileIndex | null = null;
  let bestBody = -1;
  let seen = 0;
  for (const t of game.nations[me].border) {
    if (map.coastal[t] === 0) continue;
    if (++seen > CONFIG.ai.borderSamples) break;
    if (!placeable(game, me, type, t)) continue;
    let body = 0;
    forEachNeighbor(map, t, (n) => {
      if (map.waterBody[n] >= 0) body = Math.max(body, map.waterBodySize[map.waterBody[n]]);
    });
    if (body > bestBody) {
      best = t;
      bestBody = body;
    }
  }
  return best;
}

/**
 * A port's worth: the gold of a typical trade run over the horizon when someone can trade with us, half as much again
 * when there is somewhere overseas to invade (ports carry more boats); nothing on a nation without coast.
 */
function portBenefit(game: Game, p: Perception, bot: Bot): number {
  if (p.coastalTiles === 0) return 0;
  const { tradeShip } = CONFIG.units;
  const run = ((tradeShip.goldBase + 100 * tradeShip.goldPerTile) / CONFIG.buildings.port.tradeEveryTicks)
    * CONFIG.ai.buildHorizonTicks * bot.weights.trade;
  const trading = hasTradePartner(game, p.me) ? run : 0;
  return bot.memory.overseasTargets ? Math.max(trading, run) * CONFIG.ai.portInvasionBonus : trading;
}

/** The biggest threat to `p.me`: the strongest neighbour at war, or a neutral one `strongNeutralThreat`× stronger. */
function mostThreatening(p: Perception): NeighborInfo | null {
  let worst: NeighborInfo | null = null;
  for (const n of p.neighbors) {
    if (!isThreat(p, n)) continue;
    if (worst === null || n.troops > worst.troops) worst = n;
  }
  return worst;
}

function isThreat(p: Perception, n: NeighborInfo): boolean {
  return n.relation === 'war' || (n.relation === 'neutral' && n.troops > CONFIG.ai.strongNeutralThreat * p.troops);
}

/** The strongest threatening neighbour's troops relative to ours; 0 without a threat. */
function frontThreat(p: Perception): number {
  const worst = mostThreatening(p);
  return worst === null ? 0 : worst.troops / Math.max(1, p.troops);
}

/** Whether another nation has a port on a water body touching one of `me`'s coastal border tiles. */
function hasTradePartner(game: Game, me: NationId): boolean {
  const { map } = game;
  const mine = new Set<number>();
  for (const t of game.nations[me].border) {
    if (map.coastal[t] === 0) continue;
    forEachNeighbor(map, t, (n) => {
      if (map.waterBody[n] >= 0) mine.add(map.waterBody[n]);
    });
  }
  if (mine.size === 0) return false;
  for (const b of game.buildings.byId.values()) {
    if (b.type !== 'port' || b.owner === me) continue;
    let touches = false;
    forEachNeighbor(map, b.tile, (n) => {
      if (map.waterBody[n] >= 0 && mine.has(map.waterBody[n])) touches = true;
    });
    if (touches) return true;
  }
  return false;
}

/** An owned tile at or near `me`'s centroid (the first border tile if the centroid isn't ours). */
function centroidTile(game: Game, me: NationId): TileIndex | null {
  const n = game.nations[me];
  if (n.tiles === 0) return null;
  const t = tileOf(game.map, Math.round(n.sumX / n.tiles), Math.round(n.sumY / n.tiles));
  if (game.owner[t] === me) return t;
  for (const b of n.border) return b;
  return null;
}

/** Up to `limit` of `me`'s tiles, found by a breadth-first search from `start` through `me`'s land. */
function ownTilesAround(game: Game, me: NationId, start: TileIndex | null, limit: number): TileIndex[] {
  if (start === null) return [];
  const found: TileIndex[] = [start];
  const seen = new Set<TileIndex>(found);
  for (let i = 0; i < found.length && found.length < limit; i++) {
    forEachNeighbor(game.map, found[i], (n) => {
      if (found.length < limit && !seen.has(n) && game.owner[n] === me && isLand(game.map, n)) {
        seen.add(n);
        found.push(n);
      }
    });
  }
  return found;
}

/**
 * Up to `borderSamples` of `me`'s border tiles touching another nation, or touching anything not ours when no other
 * nation borders us.
 */
function foreignBorder(game: Game, me: NationId): TileIndex[] {
  const foreign = borderTouching(game, me, (owner) => owner !== 0 && owner !== me);
  return foreign.length > 0 ? foreign : borderTouching(game, me, (owner) => owner !== me);
}

/** Up to `borderSamples` of `me`'s border tiles with a 4-neighbour whose owner passes `test`, in border order. */
function borderTouching(game: Game, me: NationId, test: (owner: NationId) => boolean): TileIndex[] {
  const out: TileIndex[] = [];
  for (const b of game.nations[me].border) {
    let hit = false;
    forEachNeighbor(game.map, b, (n) => {
      if (test(game.owner[n])) hit = true;
    });
    if (hit) out.push(b);
    if (out.length >= CONFIG.ai.borderSamples) break;
  }
  return out;
}
