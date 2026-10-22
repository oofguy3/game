import type { Command } from '../shared/types';
import { Bot } from './ai/bot';
import { PERSONALITIES } from './ai/profile';
import { Game } from './core/game';
import type { GameSetup } from './core/game';
import { Rng } from './util/rng';

/** Salt of the Rng stream that picks personalities for bots set up without one; clear of the Game's and bots' salts. */
const PERSONALITY_RNG_SALT = 7001;
/** Offsets each bot's decision ticks by id × this, so bots of one difficulty don't all think on the same tick. */
const THINK_STAGGER = 7;

/** A game together with the bots that play it. */
export class Match {
  readonly game: Game;
  /** One per bot nation, in id order. */
  readonly bots: Bot[] = [];

  /**
   * Builds the game, gives every bot nation set up without a personality a random one (written to the nation), and
   * creates the bots. The picks come from a stream of their own, so the game's Rng is left untouched.
   */
  constructor(setup: GameSetup) {
    this.game = new Game(setup);
    const personalityRng = new Rng(setup.seed).fork(PERSONALITY_RNG_SALT);
    for (const nation of this.game.nations) {
      if (nation.difficulty === null) continue;
      const personality = nation.personality ?? personalityRng.pick(PERSONALITIES);
      nation.personality = personality;
      this.bots.push(new Bot(this.game, nation.id, nation.difficulty, personality, setup.seed));
    }
  }

  /**
   * One tick: every living bot whose turn it is — (tick + id × `THINK_STAGGER`) a multiple of its `reactionTicks` —
   * thinks and its commands are queued, then the game steps. A bot acts only as itself: a command it issues for any
   * other nation is dropped.
   */
  step(): void {
    const { game } = this;
    for (const bot of this.bots) {
      if (!game.nations[bot.id].alive) continue;
      if ((game.tick + bot.id * THINK_STAGGER) % bot.profile.reactionTicks !== 0) continue;
      for (const cmd of bot.think()) {
        if (cmd.nation === bot.id) game.queue(cmd);
      }
    }
    game.step();
  }

  /** Queues `cmd` on behalf of the human player, whatever nation it names; without a player it does nothing. */
  queuePlayer(cmd: Command): void {
    const { playerId } = this.game;
    if (playerId === 0) return;
    this.game.queue({ ...cmd, nation: playerId });
  }
}
