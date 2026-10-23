import type { Difficulty, Personality } from '../../shared/types';

/** How well a difficulty level plays. No level gets extra resources; they differ only in how they decide. */
export interface DifficultyProfile {
  /** Ticks between two decisions. */
  reactionTicks: number;
  /** Relative random error applied to target scores: a score is scaled by 1 ± up to `noise`. */
  noise: number;
  /** Chance of taking the second-best target instead of the best. */
  mistakeChance: number;
  /** Shares of max troops: above the upper one the bot attacks, spending down to the lower one. */
  troopBand: [number, number];
  /** Share of the strongest hostile neighbour's troops kept at home as a reserve. */
  reserveFactor: number;
  /** Valid tiles weighed when choosing a spawn. */
  spawnSamples: number;
  /** Chance of building the best-ranked building rather than a random affordable one. */
  buildQuality: number;
  /** Weighs the land an attack would expose to counterattacks from other wars. */
  lookahead: boolean;
  /** Answers an incoming attack with a counterattack. */
  counterattack: boolean;
  /** Bombs defenses and drops paratroopers to support attacks. */
  combinedArms: boolean;
  /** Invades by boat and uses warships. */
  naval: boolean;
  /** Builds and uses aircraft. */
  air: boolean;
  /** May break an alliance to attack a weak ally. */
  betrayal: boolean;
  /** Joins others against whoever is close to winning. */
  gangUp: boolean;
}

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  easy: {
    reactionTicks: 30, noise: 0.5, mistakeChance: 0.25, troopBand: [0.75, 0.95], reserveFactor: 0,
    spawnSamples: 1, buildQuality: 0.3, lookahead: false, counterattack: false, combinedArms: false, naval: true,
    air: false, betrayal: false, gangUp: false,
  },
  normal: {
    reactionTicks: 15, noise: 0.25, mistakeChance: 0.1, troopBand: [0.5, 0.8], reserveFactor: 0.3,
    spawnSamples: 50, buildQuality: 0.7, lookahead: false, counterattack: true, combinedArms: false, naval: true,
    air: true, betrayal: false, gangUp: false,
  },
  hard: {
    reactionTicks: 8, noise: 0.1, mistakeChance: 0.03, troopBand: [0.4, 0.65], reserveFactor: 0.5,
    spawnSamples: 300, buildQuality: 0.9, lookahead: false, counterattack: true, combinedArms: true, naval: true,
    air: true, betrayal: true, gangUp: true,
  },
  insane: {
    reactionTicks: 4, noise: 0, mistakeChance: 0, troopBand: [0.35, 0.6], reserveFactor: 0.6,
    spawnSamples: 800, buildQuality: 1, lookahead: true, counterattack: true, combinedArms: true, naval: true,
    air: true, betrayal: true, gangUp: true,
  },
};

/** Multipliers a personality applies to the bot's scores; 1 is neutral. */
export interface PersonalityWeights {
  aggression: number;
  economy: number;
  defense: number;
  trade: number;
  opportunism: number;
  diplomacy: number;
  betrayal: number;
}

export const PERSONALITY: Record<Personality, PersonalityWeights> = {
  aggressive: {
    aggression: 1.4, economy: 0.8, defense: 0.8, trade: 0.6, opportunism: 1.0, diplomacy: 0.6, betrayal: 0.6,
  },
  builder: {
    aggression: 0.8, economy: 1.4, defense: 1.2, trade: 1.0, opportunism: 0.8, diplomacy: 1.0, betrayal: 0.2,
  },
  trader: {
    aggression: 0.9, economy: 1.1, defense: 1.0, trade: 1.5, opportunism: 0.9, diplomacy: 1.2, betrayal: 0.3,
  },
  opportunist: {
    aggression: 1.1, economy: 1.0, defense: 0.9, trade: 0.9, opportunism: 1.5, diplomacy: 0.8, betrayal: 0.8,
  },
  diplomat: {
    aggression: 0.9, economy: 1.0, defense: 1.0, trade: 1.1, opportunism: 0.9, diplomacy: 1.5, betrayal: 0.1,
  },
};

/** Every personality, in a fixed order, for seeded random picks. */
export const PERSONALITIES: readonly Personality[] = ['aggressive', 'builder', 'trader', 'opportunist', 'diplomat'];
