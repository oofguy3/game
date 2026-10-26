import { CONFIG } from '../../shared/config';
import type { Command, Difficulty, NationId, Personality, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { buildingCost } from '../systems/buildings';
import { isShielded } from '../systems/protection';
import { Rng } from '../util/rng';
import { chooseParadrop, manageAirDefense, planCombinedArms } from './air';
import { considerBetrayal, evaluateRequest, proposeDiplomacy } from './diplomacy';
import { chooseBuild } from './economy';
import { chooseAttacks, frontierTile } from './military';
import { chooseInvasion, manageWarships } from './naval';
import { perceive } from './perception';
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
  /** Whether the last look overseas found something to invade (makes ports worth more). */
  overseasTargets: boolean;
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
    overseasTargets: false,
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

  /**
   * The decisions themselves, made only while the game is being played: answers to the requests addressed to us; an
   * attack held back for bombs once they should have fallen; a building; attacks (one on a fortified front may wait for
   * bombs first, and the held target is left alone meanwhile); an invasion when nothing else is going on; paratroopers
   * with what the budget has left; the warships and fighters; a betrayal; and new proposals. A held target that
   * attacks us is answered at once instead. Nothing is aimed at an ally, at a nation whose alliance we accept now or
   * at one we have offered an alliance (it may accept before our command lands).
   */
  protected decide(): Command[] {
    const game = this.game;
    const me = this.id;
    let p = perceive(game, me);
    const commands: Command[] = [];
    // each command's gold comes off what the later decisions of this think see
    const issue = (cmd: Command): void => {
      commands.push(cmd);
      const gold = commandGold(game, cmd);
      if (gold > 0) p = { ...p, gold: p.gold - gold };
    };

    const accepting = new Set<NationId>();
    for (const req of [...game.requests.values()]) {
      if (req.to !== me) continue;
      const accept = evaluateRequest(game, p, this, req);
      if (accept && req.kind === 'alliance') accepting.add(req.from);
      issue({ type: 'respond', nation: me, requestId: req.id, accept });
      if (accept && req.kind === 'deal' && req.deal) p = { ...p, gold: p.gold - req.deal.getGold };
    }
    const offered = new Set<NationId>();
    for (const req of game.requests.values()) if (req.kind === 'alliance' && req.from === me) offered.add(req.to);
    const spared = (target: NationId): boolean => target !== 0
      && (game.relations.get(me, target) === 'allied' || accepting.has(target) || offered.has(target));
    const aimedAt = (cmd: Command): NationId | null => {
      if (cmd.type === 'attack' || cmd.type === 'boat' || cmd.type === 'bomb' || cmd.type === 'paradrop') return game.owner[cmd.tile];
      return null;
    };
    const allowed = (cmd: Command): boolean => {
      const target = aimedAt(cmd);
      if (target === null || spared(target)) return target === null;
      // The opening shield refuses the attack outright, so don't spend the turn on it.
      return !isShielded(game, target);
    };

    let spent = 0;
    let held: NationId | null = null;
    const pending = this.memory.pendingAttack;
    if (pending) {
      if (spared(pending.target) || p.neighbors.some((n) => n.id === pending.target && n.attackingMe > 0)) {
        this.memory.pendingAttack = null;
      } else {
        held = pending.target;
        if (game.tick >= pending.at) {
          this.memory.pendingAttack = null;
          // aimed at the front as it is now: the tile picked before the bombs may have changed hands since
          const tile = frontierTile(game, me, pending.target);
          const attack: Command | null = tile === null ? null : { type: 'attack', nation: me, tile, ratio: pending.ratio };
          if (attack && allowed(attack)) {
            issue(attack);
            spent += pending.ratio * p.troops;
          }
        }
      }
    }
    const build = chooseBuild(game, p, this);
    if (build) issue(build);
    let attacked = false;
    let bombing = false;
    for (const attack of chooseAttacks(game, p, this)) {
      if (attack.type !== 'attack' || !allowed(attack) || (held !== null && game.owner[attack.tile] === held)) continue;
      const bombs = planCombinedArms(game, p, this, attack);
      if (bombs.length > 0) {
        bombs.forEach(issue);
        bombing = true;
        continue;
      }
      issue(attack);
      spent += attack.ratio * p.troops;
      attacked = true;
    }
    if (!attacked && held === null && !bombing) {
      const invasion = chooseInvasion(game, p, this);
      if (invasion && allowed(invasion)) issue(invasion);
    }
    if (!bombing) {
      const drop = chooseParadrop(game, p, this, spent);
      if (drop && allowed(drop)) issue(drop);
    }
    manageWarships(game, p, this).forEach(issue);
    manageAirDefense(game, p, this).forEach(issue);

    const traitorTo = game.teamMode ? null : considerBetrayal(game, p, this);
    if (traitorTo !== null) {
      issue({ type: 'breakAlliance', nation: me, with: traitorTo });
      this.memory.betrayTarget = traitorTo;
    }
    proposeDiplomacy(game, p, this).forEach(issue);
    return commands;
  }
}

/** The gold `cmd` costs when it goes through (0 for commands that cost none). */
function commandGold(game: Game, cmd: Command): number {
  const U = CONFIG.units;
  switch (cmd.type) {
    case 'build': return buildingCost(game, cmd.nation, cmd.building);
    case 'bomb': return U.bomber.cost;
    case 'paradrop': return U.paraPlane.cost;
    case 'buildUnit': return cmd.unit === 'warship' ? U.warship.cost : U.fighter.cost;
    case 'proposeDeal': return cmd.deal.giveGold;
    default: return 0;
  }
}
