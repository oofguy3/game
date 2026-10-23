import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../../shared/types';
import { DIFFICULTY, PERSONALITIES, PERSONALITY } from './profile';
import type { DifficultyProfile } from './profile';

/** Easiest first. */
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard', 'insane'];
const FEATURES = ['lookahead', 'counterattack', 'combinedArms', 'naval', 'air', 'betrayal', 'gangUp'] as const;

/** Each difficulty paired with the next harder one. */
const harderPairs = (): [DifficultyProfile, DifficultyProfile][] =>
  LEVELS.slice(1).map((level, i) => [DIFFICULTY[LEVELS[i]], DIFFICULTY[level]]);

describe('DIFFICULTY', () => {
  it('matches the difficulty table', () => {
    expect(DIFFICULTY).toEqual({
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
    });
  });

  it('harder difficulties react faster with less noise and fewer mistakes', () => {
    for (const [easier, harder] of harderPairs()) {
      expect(harder.reactionTicks).toBeLessThan(easier.reactionTicks);
      expect(harder.noise).toBeLessThan(easier.noise);
      expect(harder.mistakeChance).toBeLessThan(easier.mistakeChance);
    }
  });

  it('harder difficulties plan better: bigger reserve, more spawn samples, better builds, earlier attacks', () => {
    for (const [easier, harder] of harderPairs()) {
      expect(harder.reserveFactor).toBeGreaterThan(easier.reserveFactor);
      expect(harder.spawnSamples).toBeGreaterThan(easier.spawnSamples);
      expect(harder.buildQuality).toBeGreaterThan(easier.buildQuality);
      expect(harder.troopBand[0]).toBeLessThan(easier.troopBand[0]);
      expect(harder.troopBand[1]).toBeLessThan(easier.troopBand[1]);
    }
    for (const level of LEVELS) {
      const [low, high] = DIFFICULTY[level].troopBand;
      expect(low).toBeLessThan(high);
    }
  });

  it('a feature an easier level has, every harder level has too', () => {
    for (const [easier, harder] of harderPairs()) {
      for (const feature of FEATURES) {
        if (easier[feature]) expect(harder[feature]).toBe(true);
      }
    }
  });
});

describe('PERSONALITY', () => {
  it('matches the personality table', () => {
    expect(PERSONALITY).toEqual({
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
    });
  });

  it('PERSONALITIES lists every personality once', () => {
    expect(PERSONALITIES).toEqual(['aggressive', 'builder', 'trader', 'opportunist', 'diplomat']);
    expect([...PERSONALITIES].sort()).toEqual(Object.keys(PERSONALITY).sort());
  });
});
