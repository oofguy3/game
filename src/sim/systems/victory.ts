import { CONFIG } from '../../shared/config';
import type { GameResult } from '../../shared/types';
import type { Game } from '../core/game';
import type { Nation } from '../core/nation';

/**
 * The result if the game has been won, else null. Only living nations count, never the unowned placeholder. The first
 * match wins:
 * 1. a nation holding at least `win.landShare` of the land tiles (if several do: the most tiles, then the lowest id);
 * 2. the last nation standing;
 * 3. several nations left, every pair of them allied: they win together, listed in id order.
 */
export function checkVictory(game: Game): GameResult | null {
  const alive = game.alive();
  const needed = CONFIG.win.landShare * game.map.landCount;
  let leader: Nation | null = null;
  for (const n of alive) {
    if (n.tiles >= needed && (leader === null || n.tiles > leader.tiles)) leader = n;
  }
  if (leader) return { winners: [leader.id], reason: 'landShare' };
  if (alive.length === 1) return { winners: [alive[0].id], reason: 'lastStanding' };
  if (alive.length > 1 && allAllied(game, alive)) return { winners: alive.map((n) => n.id), reason: 'alliance' };
  return null;
}

function allAllied(game: Game, nations: readonly Nation[]): boolean {
  for (let i = 0; i < nations.length; i++) {
    for (let j = i + 1; j < nations.length; j++) {
      if (game.relations.get(nations[i].id, nations[j].id) !== 'allied') return false;
    }
  }
  return true;
}
