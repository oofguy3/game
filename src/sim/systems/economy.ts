import { CONFIG } from '../../shared/config';
import type { Game } from '../core/game';
import type { Nation } from '../core/nation';

/** The troops `n` can hold before the excess starts to decay: `baseMax` + `perTile` × tiles. Task 10 adds cities. */
export function maxTroops(game: Game, n: Nation): number {
  const { baseMax, perTile } = CONFIG.troops;
  return baseMax + perTile * n.tiles;
}

/**
 * The troops `n` gains this tick. Up to max it is `baseGrowth` + `growthRate` × troops × (1 − troops / max), never
 * negative, so growth is fastest at half of max. Above max it is −`overMaxDecay` × the excess, which shrinks the excess
 * toward max. Task 10 multiplies the growth by the barracks bonus.
 */
export function troopGrowth(game: Game, n: Nation): number {
  const { baseGrowth, growthRate, overMaxDecay } = CONFIG.troops;
  const max = maxTroops(game, n);
  if (n.troops > max) return -overMaxDecay * (n.troops - max);
  return Math.max(0, baseGrowth + growthRate * n.troops * (1 - n.troops / max));
}

/** The gold `n` earns each tick: `gold.base` + `gold.perTile` × tiles. Task 10 adds factories and banks. */
export function goldIncome(game: Game, n: Nation): number {
  const { base, perTile } = CONFIG.gold;
  return base + perTile * n.tiles;
}

/**
 * One tick of the economy, in the playing phase only. Every living nation's trade income average decays by
 * `tradeIncomeDecay`; every living nation that has spawned also grows (or sheds) troops and earns its gold income,
 * which counts toward `stats.goldEarned`.
 */
export function stepEconomy(game: Game): void {
  if (game.phase !== 'playing') return;
  for (const n of game.nations) {
    if (!n.alive) continue;
    n.tradeIncome *= CONFIG.gold.tradeIncomeDecay;
    if (!n.spawned) continue;
    n.troops += troopGrowth(game, n);
    const income = goldIncome(game, n);
    n.gold += income;
    n.stats.goldEarned += income;
  }
}
