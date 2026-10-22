import { CONFIG } from '../../shared/config';
import type { Command, NationId, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { forEachNeighbor } from '../map/grid';
import { estimateConquest, isTargetTile } from '../systems/combat';
import type { Bot } from './bot';
import type { NeighborInfo, Perception } from './perception';
import type { DifficultyProfile } from './profile';

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
 */
export function reserveNeeded(p: Perception, profile: DifficultyProfile): number {
  const { incomingReserve, strongNeutralShare } = CONFIG.ai;
  let threat = 0;
  for (const n of p.neighbors) {
    if (n.relation === 'war') threat = Math.max(threat, n.troops);
    else if (n.relation === 'neutral' && n.troops > p.troops) threat = Math.max(threat, strongNeutralShare * n.troops);
  }
  return incomingReserve * p.incoming + profile.reserveFactor * threat;
}

/**
 * Troops available to attack. Above the troop band: everything down to the band floor or the reserve, whichever is
 * higher. Inside or below it: `expandShare` of the troops above the reserve when free land touches us, otherwise
 * nothing (wait and grow). Never negative.
 */
export function attackBudget(p: Perception, profile: DifficultyProfile): number {
  const reserve = reserveNeeded(p, profile);
  const [low, high] = profile.troopBand;
  let budget = 0;
  if (p.troopRatio > high) budget = p.troops - Math.max(low * p.maxTroops, reserve);
  else if (p.neutralBorder > 0) budget = (p.troops - reserve) * CONFIG.ai.expandShare;
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

  // what each war neighbour could take from us while `budget` troops are away (insane's lookahead)
  const counterRisk = (id: NationId): number => {
    if (!profile.lookahead) return 0;
    let risk = 0;
    for (const w of p.wars) {
      if (w === id) continue;
      const taken = estimateConquest(game, w, p.me, game.nations[w].troops, { defenderTroops: p.troops - budget });
      risk += (taken.tiles / Math.max(1, p.tiles)) * ai.counterRiskWeight;
    }
    return risk;
  };

  const scores: TargetScore[] = [];
  const consider = (target: NationId, base: number): void => {
    let score = base - counterRisk(target);
    score *= 1 + profile.noise * (bot.rng.next() * 2 - 1);
    if (score >= ai.minAttackScore) scores.push({ target, score, troops: budget });
  };

  if (p.neutralBorder > 0) {
    const est = estimateConquest(game, p.me, 0, budget);
    // spreading into empty land opens no front, so it carries no second-front penalty
    consider(0, (est.tiles / Math.max(1, est.attackerLoss)) * ai.neutralBias);
  }
  for (const n of p.neighbors) {
    if (n.relation === 'allied' && memory.betrayTarget !== n.id) continue;
    consider(n.id, nationScore(game, p, bot, n, budget));
  }
  return scores.sort((a, b) => b.score - a.score);
}

/** The score of attacking neighbour `n` with `budget` troops, before lookahead and noise. */
function nationScore(game: Game, p: Perception, bot: Bot, n: NeighborInfo, budget: number): number {
  const { profile, weights, memory } = bot;
  const ai = CONFIG.ai;
  const est = estimateConquest(game, p.me, n.id, budget);
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
  if (bot.profile.counterattack) {
    const counter = counterattack(game, p, bot);
    if (counter) return counter;
  }
  const scores = scoreTargets(game, p, bot);
  if (scores.length === 0) return null;
  let pick = scores[0];
  if (scores.length > 1 && bot.rng.chance(bot.profile.mistakeChance)) pick = scores[1];
  return attackOn(game, p, pick.target, pick.troops);
}

/** An attack sending `counterattackFactor` × the biggest incoming attack back at its sender, if we can spare it. */
function counterattack(game: Game, p: Perception, bot: Bot): Command | null {
  let attacker: NeighborInfo | null = null;
  for (const n of p.neighbors) {
    if (n.attackingMe > 0 && (attacker === null || n.attackingMe > attacker.attackingMe)) attacker = n;
  }
  if (attacker === null) return null;
  const troops = CONFIG.ai.counterattackFactor * attacker.attackingMe;
  if (p.troops - reserveNeeded(p, bot.profile) < troops) return null;
  return attackOn(game, p, attacker.id, troops);
}

/** An attack command sending `troops` at `target`, aimed at a target tile touching our border; null if none fits. */
function attackOn(game: Game, p: Perception, target: NationId, troops: number): Command | null {
  const ratio = troops / Math.max(1, p.troops);
  if (ratio < CONFIG.combat.minAttackRatio || Math.floor(p.troops * ratio) < 1) return null;
  const tile = frontierTile(game, p.me, target);
  if (tile === null) return null;
  return { type: 'attack', nation: p.me, tile, ratio: Math.min(1, ratio) };
}

/** The first `target` tile (unowned land for 0) touching `me`'s border, in border order; null if none. */
function frontierTile(game: Game, me: NationId, target: NationId): TileIndex | null {
  let found: TileIndex | null = null;
  for (const b of game.nations[me].border) {
    forEachNeighbor(game.map, b, (t) => {
      if (found === null && isTargetTile(game, t, target)) found = t;
    });
    if (found !== null) return found;
  }
  return null;
}
