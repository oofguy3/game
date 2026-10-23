import type { NationId } from '../../shared/types';
import type { Rng } from '../util/rng';
import type { Game } from './game';

/** Salt of the Rng stream that deals the bots into teams; clear of the Game's, bots' and personalities' salts. */
export const TEAM_RNG_SALT = 7002;

/**
 * How many of `total` nations each of `teams` teams gets, team 1 first: `floor(total / teams)` each, and the rest one
 * more each. With the player (who is on team 1) the extra nations go to the other teams, so the player's team is
 * never the biggest; without one they go to the first teams.
 */
export function teamSizes(total: number, teams: number, withPlayer: boolean): number[] {
  const base = Math.floor(total / teams);
  const extra = total % teams;
  const first = withPlayer ? 1 : 0;
  return Array.from({ length: teams }, (_, i) => base + (i >= first && i < first + extra ? 1 : 0));
}

/**
 * Deals the nations into `teams` teams of `teamSizes`: the bots are shuffled (Fisher–Yates on `rng`), then team 1 is
 * filled with the player (if `playerId` is not 0) and the first bots, and the other teams in order. Maps every nation
 * to its team, 1 to `teams`.
 */
export function assignTeams(playerId: NationId, botIds: NationId[], teams: number, rng: Rng): Map<NationId, number> {
  const order = [...botIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (playerId !== 0) order.unshift(playerId);
  const dealt = new Map<NationId, number>();
  let next = 0;
  teamSizes(order.length, teams, playerId !== 0).forEach((size, i) => {
    for (let k = 0; k < size; k++) dealt.set(order[next++], i + 1);
  });
  return dealt;
}

/** Whether `a` and `b` are two different nations on the same team (never in free-for-all). */
export function sameTeam(game: Game, a: NationId, b: NationId): boolean {
  const team = game.nations[a].team;
  return a !== b && team > 0 && game.nations[b].team === team;
}

/** Makes every pair of teammates allies, quietly: no events, and none of the alliance rules apply. */
export function lockTeams(game: Game): void {
  const n = game.nations.length;
  for (let a = 1; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (sameTeam(game, a, b)) game.relations.set(a, b, 'allied');
    }
  }
}
