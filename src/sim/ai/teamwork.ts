import { CONFIG } from '../../shared/config';
import type { AidRefusal, AttackSupport, Command, DiplomacyRequest, NationId } from '../../shared/types';
import type { Game } from '../core/game';
import { sameTeam } from '../core/teams';
import type { Attack } from '../systems/attacks';
import { buildingCost } from '../systems/buildings';
import { maxTroops } from '../systems/economy';
import type { Bot } from './bot';
import { rankBuilds } from './economy';
import { attackBudget, attackOn, reserveNeeded } from './military';
import type { Perception } from './perception';

/**
 * What `p.me` does on its own for its team now: at most one command, in teams mode only, and checked at most once
 * every `helpCheckTicks` (a check counts whether it helps or not). Teammates are looked at in id order, and the first
 * roll that succeeds acts:
 * - hit back: a teammate attacked by a neighbour of ours we aren't allied with — with a chance of our team spirit,
 *   we attack that neighbour (the one attacking it hardest);
 * - gang up: else, a teammate attacking such a neighbour — with team spirit × `joinChance`, we attack it too (the
 *   one it attacks hardest);
 * - aid: else, a teammate under attack with troops below `aidLowTroops` of its limit — with team spirit ×
 *   `aidChance`, we send it `aidTroopShare` of our troops, never dipping below our reserve.
 * `spent` is the troops already committed this think: help attacks get `helpBudgetShare` of what the attack budget
 * has left after it, and aid comes out of the troops left after it. Help attacks carry `support`. Every roll comes
 * from `bot.teamRng`.
 */
export function teamHelp(game: Game, p: Perception, bot: Bot, spent = 0): Command[] {
  const T = CONFIG.teams;
  if (game.rules.mode !== 'teams' || game.tick - bot.memory.lastHelpCheck < T.helpCheckTicks) return [];
  bot.memory.lastHelpCheck = game.tick;
  const teammates: NationId[] = [];
  for (let id = 1; id < game.nations.length; id++) {
    if (game.nations[id].alive && sameTeam(game, p.me, id)) teammates.push(id);
  }
  const rival = new Set(p.neighbors.filter((n) => n.relation !== 'allied').map((n) => n.id));

  const troops = T.helpBudgetShare * (attackBudget(p, bot.profile) - spent);
  const helpAttack = (target: NationId | null, support: AttackSupport, chance: number): Command | null => {
    if (target === null || troops < 1) return null;
    const cmd = attackOn(game, p, target, troops);
    return cmd && bot.teamRng.chance(chance) ? { ...cmd, support } : null;
  };
  for (const ally of teammates) {
    const attacker = hardest(game, rival, (a) => (a.target === ally ? a.attacker : null));
    const cmd = helpAttack(attacker, { ally, kind: 'defend' }, bot.teamSpirit);
    if (cmd) return [cmd];
  }
  for (const ally of teammates) {
    const target = hardest(game, rival, (a) => (a.attacker === ally ? a.target : null));
    const cmd = helpAttack(target, { ally, kind: 'join' }, bot.teamSpirit * T.joinChance);
    if (cmd) return [cmd];
  }

  const aid = spare(p.troops - spent, reserveNeeded(p, bot.profile), T.aidTroopShare);
  if (aid < 1) return [];
  for (const ally of teammates) {
    const n = game.nations[ally];
    if (n.troops >= T.aidLowTroops * maxTroops(game, n) || !game.attacks.some((a) => a.target === ally)) continue;
    if (bot.teamRng.chance(bot.teamSpirit * T.aidChance)) {
      return [{ type: 'sendAid', nation: p.me, to: ally, gold: 0, troops: aid }];
    }
  }
  return [];
}

/**
 * `p.me`'s answer to `req`, a teammate's ask for troops or gold: `[sendAid, respond]` for a yes, `[respond]` with the
 * reason for a no. No when we are at war and the troops attacking us pass `busyIncomingShare` of ours ('busy'), when
 * we have nothing above our reserve, or above the cost of our best-ranked building ('cantSpare'), and when the roll
 * under our team spirit fails ('notNow', from `bot.teamRng`). A yes sends `aidTroopShare` of our troops, or
 * `aidGoldShare` of our gold, never dipping below that reserve or that cost.
 */
export function answerAid(game: Game, p: Perception, bot: Bot, req: DiplomacyRequest): Command[] {
  const T = CONFIG.teams;
  const no = (reason: AidRefusal): Command[] => [
    { type: 'respond', nation: p.me, requestId: req.id, accept: false, reason },
  ];
  if (p.wars.length > 0 && p.incoming > T.busyIncomingShare * p.troops) return no('busy');
  const gold = req.resource === 'gold';
  const amount = gold
    ? spare(p.gold, nextBuildingCost(game, p, bot), T.aidGoldShare)
    : spare(p.troops, reserveNeeded(p, bot.profile), T.aidTroopShare);
  if (amount < 1) return no('cantSpare');
  if (!bot.teamRng.chance(bot.teamSpirit)) return no('notNow');
  return [
    { type: 'sendAid', nation: p.me, to: req.from, gold: gold ? amount : 0, troops: gold ? 0 : amount },
    { type: 'respond', nation: p.me, requestId: req.id, accept: true },
  ];
}

/** Whole units to give out of `have`: `share` of it, never dipping below `keep`; at most 0 when nothing is above it. */
function spare(have: number, keep: number, share: number): number {
  return Math.floor(Math.min(share * have, have - keep));
}

/** What `p.me`'s best-ranked building costs (0 when it has nothing to build): the gold it keeps back. */
function nextBuildingCost(game: Game, p: Perception, bot: Bot): number {
  const best = rankBuilds(game, p, bot)[0];
  return best ? buildingCost(game, p.me, best.type) : 0;
}

/**
 * Of the nations in `among`, the one with the most troops in the running attacks `pick` maps to it (null skips an
 * attack); the lowest id on a tie, null when there is none.
 */
function hardest(game: Game, among: Set<NationId>, pick: (a: Attack) => NationId | null): NationId | null {
  let best: { id: NationId; troops: number } | null = null;
  for (const a of game.attacks) {
    const id = pick(a);
    if (id === null || !among.has(id)) continue;
    if (best === null || a.troops > best.troops || (a.troops === best.troops && id < best.id)) {
      best = { id, troops: a.troops };
    }
  }
  return best?.id ?? null;
}
