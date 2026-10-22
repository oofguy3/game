import type { Command, Difficulty, NationId, Personality, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { Rng } from '../util/rng';
import { DIFFICULTY, PERSONALITY } from './profile';
import type { DifficultyProfile, PersonalityWeights } from './profile';

/** What a bot remembers between decisions. */
export interface BotMemory {
  lastBuildTick: number;
  /** An attack prepared for a later decision (e.g. after bombing the defenses first). */
  pendingAttack: { target: NationId; tile: TileIndex; ratio: number; at: number } | null;
  lastProposalTick: number;
  /** An ally this bot means to betray. */
  betrayTarget: NationId | null;
  /** A nation this bot prefers to attack, such as an ally's joint-attack target. */
  focusTarget: NationId | null;
  lastNavalThreatTick: number;
}

/** A tick long before any game starts, so cooldowns measured from it have always run out. */
const LONG_AGO = -1e9;
/**
 * Salt of each bot's Rng stream, offset by the bot's id. Ids are at most 41 (40 bots after the player), so the salts
 * stay clear of the Game's naming salt (1) and Match's personality salt (7001).
 */
const BOT_RNG_SALT = 1000;

/**
 * The controller of one bot nation. It reads the game like any player could and answers with commands that go through
 * the same validation as the player's.
 */
export class Bot {
  readonly id: NationId;
  readonly profile: DifficultyProfile;
  readonly weights: PersonalityWeights;
  /** This bot's own random stream: forked from `seed` by id, so bots never share draws with each other or the game. */
  readonly rng: Rng;
  memory: BotMemory = {
    lastBuildTick: LONG_AGO,
    pendingAttack: null,
    lastProposalTick: LONG_AGO,
    betrayTarget: null,
    focusTarget: null,
    lastNavalThreatTick: LONG_AGO,
  };

  private readonly game: Game;

  /** `seed` is the match seed. */
  constructor(game: Game, id: NationId, difficulty: Difficulty, personality: Personality, seed: number) {
    this.game = game;
    this.id = id;
    this.profile = DIFFICULTY[difficulty];
    this.weights = PERSONALITY[personality];
    this.rng = new Rng(seed).fork(BOT_RNG_SALT + id);
  }

  /** The commands this bot issues now, all on its own behalf. Bots act only while the game is being played. */
  think(): Command[] {
    if (this.game.phase !== 'playing') return [];
    return this.decide();
  }

  /** The decisions themselves, made only while the game is being played. */
  protected decide(): Command[] {
    // Tasks 12 onward add the decision modules here.
    return [];
  }
}
