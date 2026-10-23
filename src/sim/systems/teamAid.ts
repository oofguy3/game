import { CONFIG } from '../../shared/config';
import type { NationId } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import { sameTeam } from '../core/teams';
import { counterpartProblem, createRequest, shortfall } from './diplomacy';

const fail = (reason: string): CommandResult => ({ ok: false, reason });

/** Why `from` can't send to, ask or support `to`, or null if it can: `to` must be a living nation on `from`'s team. */
export function teammateProblem(game: Game, from: NationId, to: NationId): string | null {
  return counterpartProblem(game, from, to) ?? (sameTeam(game, from, to) ? null : 'not a teammate');
}

const askKey = (game: Game, from: NationId, to: NationId): number => from * game.nations.length + to;

/**
 * Gives teammate `to` `gold` and `troops` from `from` at once, with no accept step, and emits `aidSent`. Both amounts
 * must be finite numbers ≥ 0, not both 0, and `from` must have them now.
 */
export function sendAid(game: Game, from: NationId, to: NationId, gold: number, troops: number): CommandResult {
  const problem = teammateProblem(game, from, to);
  if (problem) return fail(problem);
  const amounts = [gold, troops];
  if (!amounts.every((a) => typeof a === 'number' && Number.isFinite(a) && a >= 0) || !amounts.some((a) => a > 0)) {
    return fail('bad amount');
  }
  const short = shortfall(game, from, gold, troops);
  if (short) return fail(short);
  const giver = game.nations[from];
  const taker = game.nations[to];
  giver.gold -= gold;
  taker.gold += gold;
  giver.troops -= troops;
  taker.troops += troops;
  game.emit({ type: 'aidSent', from, to, gold, troops });
  return { ok: true };
}

/**
 * Asks teammate `to` for `resource`: a request of kind `'aid'`. Saying yes changes nothing by itself (the teammate
 * sends what it can spare with `sendAid`). Asks of one teammate are paced by `pacedAsk`.
 */
export function askAid(game: Game, from: NationId, to: NationId, resource: 'troops' | 'gold'): CommandResult {
  const problem = teammateProblem(game, from, to);
  if (problem) return fail(problem);
  if (resource !== 'troops' && resource !== 'gold') return fail('bad resource');
  return pacedAsk(game, from, to, () => createRequest(game, 'aid', from, to, { resource }));
}

/** Ticks until `from` may ask teammate `to` again: 0 when it may, and for a nation that isn't its teammate. */
export function askReadyIn(game: Game, from: NationId, to: NationId): number {
  if (!sameTeam(game, from, to)) return 0;
  const last = game.asks.get(askKey(game, from, to));
  return last === undefined ? 0 : Math.max(0, last + CONFIG.teams.askCooldownTicks - game.tick);
}

/**
 * Makes `ask`, `from`'s request of `to`. Between teammates it is refused as 'too soon' until `askCooldownTicks` have
 * passed since `from`'s last successful ask of `to`, and a successful one starts the wait again; other pairs ask freely.
 */
export function pacedAsk(game: Game, from: NationId, to: NationId, ask: () => CommandResult): CommandResult {
  if (!sameTeam(game, from, to)) return ask();
  if (askReadyIn(game, from, to) > 0) return fail('too soon');
  const result = ask();
  if (result.ok) game.asks.set(askKey(game, from, to), game.tick);
  return result;
}
