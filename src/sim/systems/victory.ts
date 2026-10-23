import type { GameResult } from '../../shared/types';
import type { Game } from '../core/game';
import type { Nation } from '../core/nation';

/**
 * The result if the game has been won, else null. Only living nations count, never the unowned placeholder. In teams
 * mode see `checkTeamVictory`; in free-for-all the first match wins:
 * 1. a nation holding at least the rules' win share of the land tiles (if several do: the most tiles, then the lowest
 *    id);
 * 2. the last nation standing;
 * 3. several nations left, every pair of them allied: they win together, listed in id order.
 */
export function checkVictory(game: Game): GameResult | null {
  if (game.rules.mode === 'teams') return checkTeamVictory(game);
  const alive = game.alive();
  const needed = game.tuning.winShare * game.map.landCount;
  let leader: Nation | null = null;
  for (const n of alive) {
    if (n.tiles >= needed && (leader === null || n.tiles > leader.tiles)) leader = n;
  }
  if (leader) return { winners: [leader.id], reason: 'landShare' };
  if (alive.length === 1) return { winners: [alive[0].id], reason: 'lastStanding' };
  if (alive.length > 1 && allAllied(game, alive)) return { winners: alive.map((n) => n.id), reason: 'alliance' };
  return null;
}

/**
 * Teams mode: a team whose living members together hold at least the win share of the land tiles wins (if several do:
 * the most tiles, then the lowest team number); else the only team with living members wins, as the last standing.
 * The winners are every member of the team, knocked-out ones included, in id order, and the result names the team.
 */
function checkTeamVictory(game: Game): GameResult | null {
  const needed = game.tuning.winShare * game.map.landCount;
  const tiles = new Array<number>(game.rules.teams + 1).fill(0);
  const living = new Set<number>();
  for (const n of game.alive()) {
    tiles[n.team] += n.tiles;
    living.add(n.team);
  }
  let leader = 0;
  for (let team = 1; team < tiles.length; team++) {
    if (tiles[team] >= needed && (leader === 0 || tiles[team] > tiles[leader])) leader = team;
  }
  if (leader !== 0) return teamWin(game, leader, 'landShare');
  if (living.size === 1) return teamWin(game, [...living][0], 'lastStanding');
  return null;
}

function teamWin(game: Game, team: number, reason: GameResult['reason']): GameResult {
  const winners = game.nations.filter((n) => n.team === team).map((n) => n.id);
  return { winners, reason, team };
}

function allAllied(game: Game, nations: readonly Nation[]): boolean {
  for (let i = 0; i < nations.length; i++) {
    for (let j = i + 1; j < nations.length; j++) {
      if (game.relations.get(nations[i].id, nations[j].id) !== 'allied') return false;
    }
  }
  return true;
}
