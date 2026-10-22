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

const DEFENSE_TYPES = ['defensePost', 'fortress'] as const;

/**
 * How much defense buildings multiply the cost of taking `tile`: the largest `multiplier` among the tile owner's active
 * defense posts and fortresses whose `radius` reaches it. They don't stack; with none in range, or on unowned land, 1.
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
  const { estimateSamples, defenderLossFactor } = CONFIG.combat;
  const defender = game.nations[target];
  const defenderTroops = target === 0 ? 0 : opts.defenderTroops ?? defender.troops;
  const defenderDensity = defenderTroops / Math.max(1, defender.tiles);
  const landmasses = new Set<number>();
  let samples = 0;
  let costSum = 0;
  const sample = (t: TileIndex): void => {
    if (samples >= estimateSamples || !isTargetTile(game, t, target)) return;
    samples++;
    costSum += captureCostAt(game, t, defenderDensity);
    if (target === 0) landmasses.add(game.map.landmass[t]);
  };
  for (const b of game.nations[attacker].border) {
    forEachNeighbor(game.map, b, sample);
    if (samples >= estimateSamples) break;
  }
  if (samples === 0 || !(troops > 0)) return { tiles: 0, attackerLoss: 0, defenderLoss: 0 };

  const cost = costSum / samples;
  const affordable = Math.floor(troops / cost);
  const tiles = target === 0
    ? unownedLandOn(game, landmasses, affordable)
    : Math.min(affordable, defender.tiles);
  const defenderLoss = target === 0 ? 0 : Math.min(defenderTroops, tiles * defenderDensity * defenderLossFactor);
  return { tiles, attackerLoss: tiles * cost, defenderLoss };
}

/** tileCaptureCost with the owner's density supplied by the caller (ignored on unowned land). */
function captureCostAt(game: Game, tile: TileIndex, ownerDensity: number): number {
  const { terrainCost, neutralCost, baseCost, densityFactor } = CONFIG.combat;
  const t = terrainCost[game.map.terrain[tile]];
  if (game.owner[tile] === 0) return t * neutralCost;
  return t * (baseCost + ownerDensity * densityFactor) * defenseMultiplier(game, tile);
}

/**
 * The number of unowned tiles on `landmasses`, capped at `cap`. Skips the full-map count when the landmasses are
 * big enough that, even if every owned tile on the map lay on them, at least `cap` would still be unowned.
 */
function unownedLandOn(game: Game, landmasses: ReadonlySet<number>, cap: number): number {
  let size = 0;
  for (const id of landmasses) size += game.map.landmassSize[id];
  let owned = 0;
  for (const n of game.nations) owned += n.tiles;
  if (size - owned >= cap) return cap;

  const { landmass } = game.map;
  let count = 0;
  for (let t = 0; t < game.owner.length; t++) {
    if (game.owner[t] === 0 && landmasses.has(landmass[t])) count++;
  }
  return Math.min(count, cap);
}
