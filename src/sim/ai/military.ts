import { CONFIG } from '../../shared/config';
import type { Command, NationId, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { forEachNeighbor } from '../map/grid';
import { estimateConquest, isTargetTile } from '../systems/combat';
import type { ConquestEstimate } from '../systems/combat';
import type { Bot } from './bot';
import type { NeighborInfo, Perception } from './perception';
import type { DifficultyProfile } from './profile';

type AttackCommand = Extract<Command, { type: 'attack' }>;

export interface TargetScore {
  /** The nation to attack; 0 = unowned land. */
  target: NationId;
  score: number;
  /** Troops the attack would send. */
  troops: number;
}

/**
 * Troops to keep home: `incomingReserve` per troop attacking us, plus `reserveFactor` × the biggest threat among our
 * neighbours — one at war counts with all its troops, a neutral one stronger than us with `strongNeutralShare` of them.
 * Never more than `reserveCap` of our troop cap: troops held at the cap stop growing, so against an overwhelming
 * neighbour hoarding everything only wastes growth.
 */
export function reserveNeeded(p: Perception, profile: DifficultyProfile): number {
  const { incomingReserve, strongNeutralShare } = CONFIG.ai;
  let threat = 0;
  for (const n of p.neighbors) {
    if (n.relation === 'war') threat = Math.max(threat, n.troops);
    else if (n.relation === 'neutral' && n.troops > p.troops) threat = Math.max(threat, strongNeutralShare * n.troops);
  }
  return Math.min(CONFIG.ai.reserveCap * p.maxTroops, incomingReserve * p.incoming + profile.reserveFactor * threat);
}

/**
 * Troops available to attack, never below the band floor or the reserve, whichever is higher: above the band,
 * everything down to that line; inside it, `expandShare` of the troops above it when free land touches us, otherwise
 * nothing (wait and grow — troops far below the cap grow slowly, so spending them there stalls a nation). Never
 * negative.
 */
export function attackBudget(p: Perception, profile: DifficultyProfile): number {
  const reserve = reserveNeeded(p, profile);
  const [low, high] = profile.troopBand;
  let budget = 0;
  const keep = Math.max(low * p.maxTroops, reserve);
  if (p.troopRatio > high) budget = p.troops - keep;
  else if (p.neutralBorder > 0) budget = (p.troops - keep) * CONFIG.ai.expandShare;
  return Math.max(0, budget);
}

/**
 * Every attack worth making with the current budget, best first. Candidates are free land (when it touches us) and
 * every neighbour we aren't allied with — or the ally we mean to betray.
 */
export function scoreTargets(game: Game, p: Perception, bot: Bot): TargetScore[] {
  const budget = attackBudget(p, bot.profile);
  if (budget < 1) return [];
  const { profile, memory } = bot;
  const ai = CONFIG.ai;

  // the share of our land each other war could take while `sent` troops are away (insane's lookahead)
  const counterRisk = (id: NationId, sent: number): number => {
    if (!profile.lookahead) return 0;
    let risk = 0;
    for (const w of p.wars) {
      if (w === id) continue;
      const taken = estimateConquest(game, w, p.me, game.nations[w].troops, { defenderTroops: p.troops - sent });
      risk += (taken.tiles / Math.max(1, p.tiles)) * ai.counterRiskWeight;
    }
    return risk;
  };

  // troops above the band are surplus (they grow little more there), so any gain beats keeping them
  const minScore = p.troopRatio > profile.troopBand[1] ? 0 : ai.minAttackScore;
  const scores: TargetScore[] = [];
  const consider = (target: NationId, base: number, troops: number): void => {
    let score = base * Math.max(0, 1 - counterRisk(target, troops));
    score *= 1 + profile.noise * (bot.rng.next() * 2 - 1);
    if (score > 0 && score >= minScore && troops >= 1) scores.push({ target, score, troops });
  };

  if (p.neutralBorder > 0) {
    const est = estimateConquest(game, p.me, 0, budget);
    // spreading into empty land opens no front, so it carries no second-front penalty
    consider(0, (est.tiles / Math.max(1, est.attackerLoss)) * ai.neutralBias, paced(game, p, bot, 0, p.neutralBorder, est, budget));
  }
  for (const n of p.neighbors) {
    if (n.relation === 'allied' && memory.betrayTarget !== n.id) continue;
    const est = estimateConquest(game, p.me, n.id, budget);
    consider(n.id, nationScore(p, bot, n, est), paced(game, p, bot, n.id, n.sharedBorder, est, budget));
  }
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * The troops worth sending at `target` now: what an attack along a front of `front` tiles can spend over
 * `paceMargin` of this bot's decision intervals (at the estimate's cost per tile), less the troops our running attack
 * on it already holds, and never more than `budget`. Troops parked in an attack don't grow, so sending more is waste —
 * unless troops fill `saturatedRatio` of the cap, where they barely grow either: then at least a
 * `maxAttacksPerThink`-th of the budget goes.
 */
function paced(
  game: Game, p: Perception, bot: Bot, target: NationId, front: number, est: ConquestEstimate, budget: number,
): number {
  if (est.tiles === 0) return 0;
  const { frontFraction, minTilesPerTick, maxTilesPerTick } = CONFIG.combat;
  const perTick = Math.min(maxTilesPerTick, Math.max(minTilesPerTick, front * frontFraction));
  const useful = perTick * bot.profile.reactionTicks * CONFIG.ai.paceMargin * (est.attackerLoss / est.tiles);
  let committed = 0;
  for (const a of game.attacks) if (a.attacker === p.me && a.target === target) committed += a.troops;
  // saturated, troops at home are worth nothing: each target gets at least its share of the budget
  const floor = p.troopRatio >= CONFIG.ai.saturatedRatio ? budget / CONFIG.ai.maxAttacksPerThink : 0;
  return Math.min(budget, Math.max(floor, useful - committed));
}

/** The score of attacking neighbour `n` (allied or not) with the whole attack budget, without noise; 0 without one. */
export function scoreNeighbor(game: Game, p: Perception, bot: Bot, n: NeighborInfo): number {
  const budget = attackBudget(p, bot.profile);
  if (budget < 1) return 0;
  return nationScore(p, bot, n, estimateConquest(game, p.me, n.id, budget));
}

/** The score of attacking neighbour `n`, given the estimate `est` of attacking it with the budget. */
function nationScore(p: Perception, bot: Bot, n: NeighborInfo, est: ConquestEstimate): number {
  const { profile, weights, memory } = bot;
  const ai = CONFIG.ai;
  const gain = est.tiles + (ai.buildingTileValue * n.buildings * est.tiles) / Math.max(1, n.tiles);
  const opportunity = (n.otherWars > 0 ? 0.5 : 0) + (n.density < p.density ? 0.3 : 0);
  let score = (gain / Math.max(1, est.attackerLoss)) * weights.aggression * (1 + weights.opportunism * opportunity);
  if (n.relation !== 'war' && p.wars.length > 0) score *= ai.secondFrontPenalty;
  if (profile.gangUp && n.id === p.leader && p.leaderShare > ai.gangUpShare) score *= 2;
  if (memory.focusTarget === n.id) score *= 1.5;
  return score;
}

/**
 * The attack this bot makes now, or null. A counterattack on the biggest incoming attack comes first (normal and up)
 * when the troops beyond the reserve can cover it; otherwise the best-scoring target, or with `mistakeChance` the
 * second best.
 */
export function chooseAttack(game: Game, p: Perception, bot: Bot): Command | null {
  return chooseAttacks(game, p, bot)[0] ?? null;
}

/**
 * The attacks this bot makes now: a counterattack alone when one is due; otherwise targets in score order (the top two
 * swapped with `mistakeChance`), each given the troops it can use, until the budget runs out or
 * `maxAttacksPerThink` attacks are made. A budget one front can't absorb is spread rather than left idle.
 */
export function chooseAttacks(game: Game, p: Perception, bot: Bot): Command[] {
  if (bot.profile.counterattack) {
    const counter = counterattack(game, p, bot);
    if (counter) return [counter];
  }
  const scores = scoreTargets(game, p, bot);
  if (scores.length > 1 && bot.rng.chance(bot.profile.mistakeChance)) [scores[0], scores[1]] = [scores[1], scores[0]];
  let remaining = attackBudget(p, bot.profile);
  const attacks: Command[] = [];
  for (const s of scores) {
    if (attacks.length >= CONFIG.ai.maxAttacksPerThink || remaining < 1) break;
    const cmd = attackOn(game, p, s.target, Math.min(remaining, s.troops));
    if (cmd === null) continue;
    attacks.push(cmd);
    remaining -= cmd.ratio * p.troops;
  }
  return attacks;
}

/** An attack sending `counterattackFactor` × the biggest incoming attack back at its sender, if we can spare it. */
function counterattack(game: Game, p: Perception, bot: Bot): AttackCommand | null {
  let attacker: NeighborInfo | null = null;
  for (const n of p.neighbors) {
    if (n.attackingMe > 0 && (attacker === null || n.attackingMe > attacker.attackingMe)) attacker = n;
  }
  if (attacker === null) return null;
  const troops = CONFIG.ai.counterattackFactor * attacker.attackingMe;
  if (p.troops - reserveNeeded(p, bot.profile) < troops) return null;
  return attackOn(game, p, attacker.id, troops);
}

/**
 * An attack command sending `troops` at `target`, aimed at a target tile touching our border; null if none fits. An
 * attack command sends at least `minAttackRatio` of the pool, so a smaller amount is rounded up to that.
 */
export function attackOn(game: Game, p: Perception, target: NationId, troops: number): AttackCommand | null {
  const ratio = Math.max(CONFIG.combat.minAttackRatio, troops / Math.max(1, p.troops));
  if (Math.floor(p.troops * ratio) < 1) return null;
  const tile = frontierTile(game, p.me, target);
  if (tile === null) return null;
  return { type: 'attack', nation: p.me, tile, ratio: Math.min(1, ratio) };
}

/** The first `target` tile (unowned land for 0) touching `me`'s border, in border order; null if none. */
export function frontierTile(game: Game, me: NationId, target: NationId): TileIndex | null {
  let found: TileIndex | null = null;
  for (const b of game.nations[me].border) {
    forEachNeighbor(game.map, b, (t) => {
      if (found === null && isTargetTile(game, t, target)) found = t;
    });
    if (found !== null) return found;
  }
  return null;
}
