import { CONFIG } from '../../shared/config';
import { Terrain } from '../../shared/types';
import type { NationId, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import type { Nation } from '../core/nation';
import { forEachNeighbor } from '../map/grid';
import { buildingsInRadius } from './buildings';

export interface ConquestEstimate {
  tiles: number;
  attackerLoss: number;
  defenderLoss: number;
}

/** Troops per owned tile; a nation with no tiles counts as holding one. */
export function density(n: Nation): number {
  return n.troops / Math.max(1, n.tiles);
}

const DEFENSE_TYPES = ['defensePost', 'fortress', 'capital'] as const;

/**
 * How much defense buildings multiply the cost of taking `tile`: the largest `multiplier` among the tile owner's active
 * defense posts, fortresses and capital whose `radius` reaches it. They don't stack; with none in range, or on unowned
 * land, 1.
 */
export function defenseMultiplier(game: Game, tile: TileIndex): number {
  const owner = game.owner[tile];
  if (owner === 0) return 1;
  const counts = game.nations[owner].buildingCounts;
  let best = 1;
  for (const type of DEFENSE_TYPES) {
    const { radius, multiplier } = CONFIG.buildings[type];
    // buildingCounts holds active buildings only, so most calls end here without a search
    if (counts[type] === 0 || multiplier <= best) continue;
    if (buildingsInRadius(game, owner, [type], tile, radius).some((b) => b.ticksLeft === 0)) best = multiplier;
  }
  return best;
}

/**
 * Troops `attacker` spends to take `tile`: terrain cost × `neutralCost` on unowned land, otherwise
 * terrain cost × (`baseCost` + owner density × `densityFactor`) × the tile's defense multiplier.
 */
export function tileCaptureCost(game: Game, attacker: NationId, tile: TileIndex): number {
  const owner = game.owner[tile];
  return captureCostAt(game, tile, owner === 0 ? 0 : density(game.nations[owner]));
}

/** Troops the owner of `tile` loses when it is taken: owner density × `defenderLossFactor`; 0 on unowned land. */
export function defenderLossPerTile(game: Game, tile: TileIndex): number {
  const owner = game.owner[tile];
  if (owner === 0) return 0;
  return density(game.nations[owner]) * CONFIG.combat.defenderLossFactor;
}

/** Whether an attack on `target` can take `tile`: one of the target's tiles, or unowned land when `target` is 0. */
export function isTargetTile(game: Game, tile: TileIndex, target: NationId): boolean {
  return game.owner[tile] === target && (target !== 0 || game.map.terrain[tile] !== Terrain.Water);
}

export interface EstimateOptions {
  /** Price the target as if it held this many troops instead of its current count (what-if questions). */
  defenderTroops?: number;
}

/**
 * What sending `troops` from `attacker` against `target` (0 = unowned land) would likely achieve. Averages the capture
 * cost over up to `estimateSamples` frontier tiles (target tiles touching the attacker's border), then takes as many
 * tiles as the troops pay for, at most the target's tiles (for unowned land: the unowned tiles of the landmasses the
 * sampled frontier lies on). Losses follow from that tile count. Pure: changes nothing and draws no random numbers.
 * Ignores the defender's troop growth while the attack runs.
 */
export function estimateConquest(
  game: Game,
  attacker: NationId,
  target: NationId,
  troops: number,
  opts: EstimateOptions = {},
): ConquestEstimate {
  const { neutralCost, baseCost, densityFactor, defenderLossFactor } = CONFIG.combat;
  const tally = frontierTallies(game, attacker).get(target);
  if (!tally || !(troops > 0)) return { tiles: 0, attackerLoss: 0, defenderLoss: 0 };
  const defender = game.nations[target];
  const defenderTroops = target === 0 ? 0 : opts.defenderTroops ?? defender.troops;
  const defenderDensity = defenderTroops / Math.max(1, defender.tiles);
  const cost = (tally.weight * (target === 0 ? neutralCost : baseCost + defenderDensity * densityFactor)) / tally.samples;
  const affordable = Math.floor(troops / cost);
  const tiles = target === 0
    ? unownedLandOn(game, tally.landmasses, affordable)
    : Math.min(affordable, defender.tiles);
  const defenderLoss = target === 0 ? 0 : Math.min(defenderTroops, tiles * defenderDensity * defenderLossFactor);
  return { tiles, attackerLoss: tiles * cost, defenderLoss };
}

/** The first `estimateSamples` frontier tiles of one target: how many, and their terrain cost × defense, summed. */
interface FrontierTally {
  samples: number;
  /** Σ terrain cost × defense multiplier (just terrain cost on unowned land). */
  weight: number;
  /** Landmasses of the sampled tiles (unowned land only). */
  landmasses: Set<number>;
}

/** Per game: the tallies of each attacker's frontier, valid while the tick, the owners and the buildings stay put. */
const frontierCache = new WeakMap<Game, {
  tick: number; ownerVersion: number; buildingsVersion: number; byAttacker: Map<NationId, Map<NationId, FrontierTally>>;
}>();

/**
 * For every target touching `attacker`'s border (0 = unowned land): the tally of its first `estimateSamples` tiles met
 * walking the border in order (a tile counted once per border tile it touches). One walk serves every target, and is
 * reused until the tick, an owner or a building changes.
 */
function frontierTallies(game: Game, attacker: NationId): Map<NationId, FrontierTally> {
  let cache = frontierCache.get(game);
  if (!cache || cache.tick !== game.tick || cache.ownerVersion !== game.ownerVersion
    || cache.buildingsVersion !== game.buildings.version) {
    cache = { tick: game.tick, ownerVersion: game.ownerVersion, buildingsVersion: game.buildings.version, byAttacker: new Map() };
    frontierCache.set(game, cache);
  }
  const known = cache.byAttacker.get(attacker);
  if (known) return known;
  const tallies = new Map<NationId, FrontierTally>();
  const { map, owner } = game;
  const { terrainCost, estimateSamples } = CONFIG.combat;
  const visit = (t: TileIndex): void => {
    const o = owner[t];
    if (o === attacker || (o === 0 && map.terrain[t] === Terrain.Water)) return;
    let tally = tallies.get(o);
    if (!tally) tallies.set(o, (tally = { samples: 0, weight: 0, landmasses: new Set() }));
    if (tally.samples >= estimateSamples) return;
    tally.samples++;
    const terrain = terrainCost[map.terrain[t]];
    if (o === 0) {
      tally.weight += terrain;
      tally.landmasses.add(map.landmass[t]);
    } else tally.weight += terrain * defenseMultiplier(game, t);
  };
  for (const b of game.nations[attacker].border) forEachNeighbor(map, b, visit);
  cache.byAttacker.set(attacker, tallies);
  return tallies;
}

/** tileCaptureCost with the owner's density supplied by the caller (ignored on unowned land). */
function captureCostAt(game: Game, tile: TileIndex, ownerDensity: number): number {
  const { terrainCost, neutralCost, baseCost, densityFactor } = CONFIG.combat;
  const t = terrainCost[game.map.terrain[tile]];
  if (game.owner[tile] === 0) return t * neutralCost;
  return t * (baseCost + ownerDensity * densityFactor) * defenseMultiplier(game, tile);
}

/** The number of unowned land tiles on `landmasses`, capped at `cap`. */
function unownedLandOn(game: Game, landmasses: ReadonlySet<number>, cap: number): number {
  let free = 0;
  for (const id of landmasses) free += game.unownedLand[id];
  return Math.min(free, cap);
}
