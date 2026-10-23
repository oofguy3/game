import { CONFIG } from '../../shared/config';
import type { Command, Deal, DiplomacyRequest, NationId } from '../../shared/types';
import type { Game } from '../core/game';
import { sameTeam } from '../core/teams';
import { estimateConquest } from '../systems/combat';
import { goldIncome, troopGrowth } from '../systems/economy';
import type { Bot } from './bot';
import { troopGoldValue } from './economy';
import { scoreNeighbor, scoreTargets } from './military';
import type { NeighborInfo, Perception } from './perception';

/**
 * Whether `p.me` accepts `req`, a request addressed to it:
 * - an alliance, unless it comes from the runaway leader, would leave us nothing to take by land, comes from a nation
 *   trusted less than `allyTrust` or from our best target; and only from a partner with `allyStrength` of our troops,
 *   or if we are diplomatic (`allyDiplomacy`);
 * - peace, when they would take more of us than we of them, when neither can reach the other over land, or when we
 *   have another war;
 * - a deal, when what we get is worth more than what we give (gold at 1, troops at `troopGoldValue`, ×`warTroopValue`
 *   at war) and we can pay;
 * - a joint attack on a neighbour we aren't allied with that scores `jointAttackShare` of our best target; accepting
 *   it focuses our attacks on that target.
 */
export function evaluateRequest(game: Game, p: Perception, bot: Bot, req: DiplomacyRequest): boolean {
  const ai = CONFIG.ai;
  switch (req.kind) {
    case 'alliance': {
      if (req.from === p.leader && p.leaderShare > ai.gangUpShare) return false;
      if (isolatedWith(p, req.from)) return false;
      if (game.relations.trust(p.me, req.from) < ai.allyTrust) return false;
      if (scoreTargets(game, p, bot)[0]?.target === req.from) return false;
      return game.nations[req.from].troops >= ai.allyStrength * p.troops || bot.weights.diplomacy >= ai.allyDiplomacy;
    }
    case 'peace': {
      if (p.wars.some((w) => w !== req.from)) return true;
      const ours = estimateConquest(game, p.me, req.from, p.troops).tiles;
      const theirs = estimateConquest(game, req.from, p.me, game.nations[req.from].troops).tiles;
      // a war neither side can fight over land isn't worth keeping
      return ours < theirs || (ours === 0 && theirs === 0);
    }
    case 'deal':
      return req.deal !== undefined && p.gold >= req.deal.getGold && p.troops >= req.deal.getTroops
        && dealGain(p, req.deal) > 0;
    case 'jointAttack': {
      const target = req.target;
      if (target === undefined || !p.neighbors.some((n) => n.id === target && n.relation !== 'allied')) return false;
      const scores = scoreTargets(game, p, bot);
      const best = scores[0]?.score ?? 0;
      const theirs = scores.find((s) => s.target === target)?.score ?? 0;
      if (best <= 0 || theirs < ai.jointAttackShare * best) return false;
      bot.memory.focusTarget = target;
      return true;
    }
  }
}

/** Whether `p.me` would have nothing left to expand into by land if it were also allied with `partner`. */
function isolatedWith(p: Perception, partner: NationId): boolean {
  return p.neutralBorder === 0 && p.neighbors.every((n) => n.id === partner || n.relation === 'allied');
}

/** What `deal` (offered to `p.me`) is worth to it: what it gets less what it gives, in gold. */
function dealGain(p: Perception, deal: Deal): number {
  const troop = troopGoldValue(p) * (p.wars.length > 0 ? CONFIG.ai.warTroopValue : 1);
  return deal.giveGold + deal.giveTroops * troop - deal.getGold - deal.getTroops * troop;
}

/**
 * The proposals `p.me` makes now, at most once per `proposalCooldownTicks` and never one already pending (either way
 * round for alliances and peace):
 * - losing (incoming above `peaceIncomingShare` of our troops): peace to whoever attacks hardest;
 * - at war with a strong neutral neighbour (`allyStrength`): an alliance with the strongest, to avoid a second front;
 * - ganging up (hard and up) on a runaway leader: an alliance with the strongest neutral neighbour besides it, and a
 *   joint attack on it asked of each ally;
 * - at war with gold idle for `richIncomeTicks` of income: troops bought from the strongest nation not at war with us.
 * With no alliances in the rules, or in teams mode (teammates are allies already, other teams never), it never proposes
 * an alliance.
 */
export function proposeDiplomacy(game: Game, p: Perception, bot: Bot): Command[] {
  const ai = CONFIG.ai;
  if (game.tick - bot.memory.lastProposalTick < ai.proposalCooldownTicks) return [];
  const me = p.me;
  const cmds: Command[] = [];

  if (p.incoming > ai.peaceIncomingShare * p.troops) {
    let worst: NeighborInfo | null = null;
    for (const n of p.neighbors) {
      if (n.relation === 'war' && n.attackingMe > 0 && (worst === null || n.attackingMe > worst.attackingMe)) worst = n;
    }
    if (worst && !pending(game, 'peace', me, worst.id)) cmds.push({ type: 'proposePeace', nation: me, to: worst.id });
  }

  const ganging = bot.profile.gangUp && p.leader !== 0 && p.leader !== me && p.leaderShare > ai.gangUpShare;
  const partners = game.tuning.alliances && game.rules.mode !== 'teams'
    ? p.neighbors.filter((n) => n.relation === 'neutral' && game.relations.trust(me, n.id) >= ai.allyTrust
      && !pending(game, 'alliance', me, n.id))
    : [];
  let ally: NeighborInfo | null = null;
  if (p.wars.length > 0) ally = strongest(partners.filter((n) => n.troops >= ai.allyStrength * p.troops));
  if (ally === null && ganging) ally = strongest(partners.filter((n) => n.id !== p.leader));
  if (ally) cmds.push({ type: 'proposeAlliance', nation: me, to: ally.id });

  if (ganging && game.relations.get(me, p.leader) !== 'allied') {
    for (let a = 1; a < game.nations.length; a++) {
      if (a === me || a === p.leader || a === bot.memory.betrayTarget || !game.nations[a].alive) continue;
      if (game.relations.get(me, a) !== 'allied' || game.relations.get(a, p.leader) === 'allied') continue;
      if (pending(game, 'jointAttack', me, a, false)) continue;
      cmds.push({ type: 'requestJointAttack', nation: me, to: a, target: p.leader });
    }
  }

  const purchase = troopPurchase(game, p);
  if (purchase) cmds.push(purchase);

  if (cmds.length > 0) bot.memory.lastProposalTick = game.tick;
  return cmds;
}

/** The strongest of `ns` (lowest id on a tie), or null. */
function strongest(ns: NeighborInfo[]): NeighborInfo | null {
  let best: NeighborInfo | null = null;
  for (const n of ns) if (best === null || n.troops > best.troops) best = n;
  return best;
}

/** Whether a request of `kind` from `from` to `to` is open — or, with `bothWays`, from `to` to `from`. */
function pending(game: Game, kind: DiplomacyRequest['kind'], from: NationId, to: NationId, bothWays = true): boolean {
  for (const r of game.requests.values()) {
    if (r.kind !== kind) continue;
    if ((r.from === from && r.to === to) || (bothWays && r.from === to && r.to === from)) return true;
  }
  return false;
}

/**
 * A deal buying troops when at war with gold idle for `richIncomeTicks` of income: from the strongest living nation
 * not at war with us (allies first), up to `dealTroopShare` of its troops for at most `dealGoldShare` of our gold,
 * priced `dealMargin` above what the seller's own rule values them at so it accepts.
 */
function troopPurchase(game: Game, p: Perception): Command | null {
  const ai = CONFIG.ai;
  if (p.wars.length === 0 || p.gold <= ai.richIncomeTicks * p.income) return null;
  let seller: NationId = 0;
  let sellerRank = -Infinity;
  for (let id = 1; id < game.nations.length; id++) {
    const n = game.nations[id];
    if (id === p.me || !n.alive || game.relations.get(p.me, id) === 'war' || pending(game, 'deal', p.me, id, false)) continue;
    const rank = (game.relations.get(p.me, id) === 'allied' ? 1e12 : 0) + n.troops;
    if (rank > sellerRank) {
      seller = id;
      sellerRank = rank;
    }
  }
  if (seller === 0) return null;
  const n = game.nations[seller];
  const atWar = game.relations.warsOf(seller).some((w) => game.nations[w].alive);
  const worth = (goldIncome(game, n) / Math.max(1, troopGrowth(game, n))) * (atWar ? ai.warTroopValue : 1);
  const price = worth * ai.dealMargin;
  if (!(price > 0)) return null;
  const getTroops = Math.min(Math.floor((p.gold * ai.dealGoldShare) / price), Math.floor(n.troops * ai.dealTroopShare));
  if (getTroops < 1) return null;
  const giveGold = Math.ceil(getTroops * price);
  return { type: 'proposeDeal', nation: p.me, to: seller, deal: { giveGold, giveTroops: 0, getGold: 0, getTroops } };
}

/**
 * The ally `p.me` would betray now, or null; only profiles that betray, and never a teammate. Boxed in by allies (no
 * free land, every neighbour an ally) with troops above the band, the ally that scores best, whatever the personality.
 * Otherwise only with a betrayal weight of `betrayalWeight` or more, an ally that scores `betrayalScore` times our best
 * other target and has under `betrayalDensity` of our density.
 */
export function considerBetrayal(game: Game, p: Perception, bot: Bot): NationId | null {
  const ai = CONFIG.ai;
  if (!bot.profile.betrayal) return null;
  const allies = p.neighbors.filter((n) => n.relation === 'allied' && !sameTeam(game, p.me, n.id));
  if (allies.length === 0) return null;
  // boxed in by allies with troops piling up: the weakest-defended ally is the only way on
  if (p.neutralBorder === 0 && allies.length === p.neighbors.length && p.troopRatio > bot.profile.troopBand[1]) {
    let pick: { id: NationId; score: number } | null = null;
    for (const n of allies) {
      const score = scoreNeighbor(game, p, bot, n);
      if (score > 0 && (pick === null || score > pick.score)) pick = { id: n.id, score };
    }
    if (pick) return pick.id;
  }
  if (bot.weights.betrayal < ai.betrayalWeight) return null;
  const next = scoreTargets(game, p, bot).find((s) => game.relations.get(p.me, s.target) !== 'allied')?.score ?? 0;
  let best: { id: NationId; score: number } | null = null;
  for (const n of allies) {
    if (n.density >= ai.betrayalDensity * p.density) continue;
    const score = scoreNeighbor(game, p, bot, n);
    if (score <= 0 || score < ai.betrayalScore * next) continue;
    if (best === null || score > best.score) best = { id: n.id, score };
  }
  return best?.id ?? null;
}
