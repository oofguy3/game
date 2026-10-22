import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../shared/config';
import type { Command, Difficulty } from '../shared/types';
import { Bot } from './ai/bot';
import { DIFFICULTY, PERSONALITIES, PERSONALITY } from './ai/profile';
import { Game } from './core/game';
import type { GameSetup } from './core/game';
import { Match } from './match';
import { makeTestGame } from './testing/fixtures';
import { mapFromAscii } from './testing/asciiMap';

/** A 20×12 plains map with two bots and no player; `overrides` replace any field. */
const setup = (overrides: Partial<GameSetup> = {}): GameSetup => ({
  map: mapFromAscii(Array.from({ length: 12 }, () => '#'.repeat(20))),
  seed: 7,
  player: null,
  bots: [{ difficulty: 'easy' }, { difficulty: 'insane' }],
  ...overrides,
});

const botsOf = (...levels: Difficulty[]): GameSetup['bots'] => levels.map((difficulty) => ({ difficulty }));

/** A bot that, whenever it gets to decide, grants itself 1 gold. */
class EagerBot extends Bot {
  protected override decide(): Command[] {
    return [{ type: 'debugGrant', nation: this.id, gold: 1 }];
  }
}

describe('Match', () => {
  it('Match runs bots on their reaction cadence', () => {
    const m = new Match(setup({ bots: botsOf('easy', 'normal', 'hard', 'insane') }));
    const thinks = m.bots.map((bot) => vi.spyOn(bot, 'think'));
    for (let i = 0; i < 120; i++) m.step();
    // the 120 ticks cover the whole spawn phase and the start of play
    expect(m.game.tick).toBe(120);
    expect(m.game.phase).toBe('playing');
    expect(thinks.map((spy) => spy.mock.calls.length)).toEqual([4, 8, 15, 30]);
  });

  it('staggers bots of the same difficulty by id', () => {
    const m = new Match(setup({ bots: botsOf('insane', 'insane') }));
    const ticks = m.bots.map((bot) => {
      const seen: number[] = [];
      vi.spyOn(bot, 'think').mockImplementation(() => {
        seen.push(m.game.tick);
        return [];
      });
      return seen;
    });
    for (let i = 0; i < 12; i++) m.step();
    // bot id thinks when (tick + id × 7) is a multiple of its 4 reaction ticks
    expect(ticks).toEqual([[1, 5, 9], [2, 6, 10]]);
  });

  it('queues the commands a bot returns before stepping the game', () => {
    const m = new Match(setup({ bots: botsOf('insane'), debug: true }));
    const grant: Command = { type: 'debugGrant', nation: 1, gold: 10 };
    vi.spyOn(m.bots[0], 'think').mockReturnValue([grant]);
    const start = CONFIG.spawn.startGold;
    m.step(); // tick 0: the bot spawns (setting its gold) but doesn't think
    expect(m.game.nations[1].gold).toBe(start);
    m.step(); // tick 1: (1 + 7) % 4 === 0
    expect(m.game.nations[1].gold).toBe(start + 10);
    for (let i = 0; i < 6; i++) m.step();
    expect(m.game.nations[1].gold).toBe(start + 20);
    expect(m.game.drainEvents().filter((e) => e.type !== 'spawned')).toEqual([]);
  });

  it('drops any command a bot issues for another nation', () => {
    const m = new Match(setup({ player: { name: 'You' }, bots: botsOf('insane'), debug: true }));
    const forPlayer: Command = { type: 'debugGrant', nation: 1, gold: 10 };
    const forSelf: Command = { type: 'debugGrant', nation: 2, gold: 5 };
    vi.spyOn(m.bots[0], 'think').mockReturnValue([forPlayer, forSelf]);
    const queue = vi.spyOn(m.game, 'queue');
    for (let i = 0; i < 3; i++) m.step(); // bot 2 thinks at tick 2: (2 + 14) % 4 === 0
    // besides its spawn at tick 0, only the bot's command for itself is queued
    expect(queue.mock.calls.filter(([c]) => c.type !== 'spawn')).toEqual([[forSelf]]);
    expect(m.game.nations[1].gold).toBe(0);
    expect(m.game.nations[2].gold).toBe(CONFIG.spawn.startGold + 5);
  });

  it('issues no bot commands outside the playing phase', () => {
    // victory off: a lone bot would otherwise win as the last nation standing the moment play starts
    const s = setup({ bots: botsOf('insane'), debug: true, checkVictory: false });
    const m = new Match(s);
    m.bots[0] = new EagerBot(m.game, 1, 'insane', 'aggressive', s.seed);
    const queue = vi.spyOn(m.game, 'queue');
    const grant: Command = { type: 'debugGrant', nation: 1, gold: 1 };

    while (m.game.phase === 'spawn') m.step();
    expect(queue).not.toHaveBeenCalledWith(grant);

    for (let i = 0; i < 4; i++) m.step();
    expect(queue).toHaveBeenCalledWith(grant);

    queue.mockClear();
    m.game.phase = 'ended';
    for (let i = 0; i < 4; i++) m.step();
    expect(queue).not.toHaveBeenCalledWith(grant);
  });

  it('dead bots do not think', () => {
    const m = new Match(setup());
    m.game.nations[2].alive = false;
    const thinks = m.bots.map((bot) => vi.spyOn(bot, 'think'));
    for (let i = 0; i < 60; i++) m.step();
    expect(thinks.map((spy) => spy.mock.calls.length)).toEqual([2, 0]);
  });

  it('Match.queuePlayer forces the player nation', () => {
    const m = new Match(setup({ player: { name: 'You' }, bots: botsOf('easy'), debug: true }));
    const cmd: Command = { type: 'debugGrant', nation: 2, gold: 50 };
    m.queuePlayer(cmd);
    m.step();
    expect(m.game.nations[1].gold).toBe(50);
    // the bot only got its spawn's starting gold
    expect(m.game.nations[2].gold).toBe(CONFIG.spawn.startGold);
    expect(cmd.nation).toBe(2);
  });

  it('queuePlayer does nothing without a player', () => {
    const m = new Match(setup({ debug: true }));
    m.queuePlayer({ type: 'debugGrant', nation: 1, gold: 50 });
    m.step();
    // bot 1 only got its spawn's starting gold
    expect(m.game.nations[1].gold).toBe(CONFIG.spawn.startGold);
    expect(m.game.drainEvents().filter((e) => e.type !== 'spawned')).toEqual([]);
  });

  it('creates one bot per bot nation with its difficulty profile and personality weights', () => {
    const m = new Match(setup({
      player: { name: 'You' },
      bots: [{ difficulty: 'easy', personality: 'builder' }, { difficulty: 'insane', personality: 'diplomat' }],
    }));
    expect(m.bots.map((bot) => bot.id)).toEqual([2, 3]);
    expect(m.bots[0].profile).toBe(DIFFICULTY.easy);
    expect(m.bots[0].weights).toBe(PERSONALITY.builder);
    expect(m.bots[1].profile).toBe(DIFFICULTY.insane);
    expect(m.bots[1].weights).toBe(PERSONALITY.diplomat);
    expect(m.game.nations[2].personality).toBe('builder');
    expect(m.game.nations[3].personality).toBe('diplomat');
  });

  it('gives each bot without a personality one of the five, from its own random stream', () => {
    const levels = botsOf(...Array.from({ length: 20 }, (): Difficulty => 'normal'));
    const s = setup({ bots: [{ difficulty: 'hard', personality: 'trader' }, ...levels] });
    const m = new Match(s);
    const personalities = (match: Match) => match.bots.map((bot) => match.game.nations[bot.id].personality);

    expect(m.game.nations[1].personality).toBe('trader');
    for (const p of personalities(m)) expect(PERSONALITIES).toContain(p);
    expect(new Set(personalities(m)).size).toBeGreaterThan(1);
    for (const bot of m.bots) expect(bot.weights).toBe(PERSONALITY[m.game.nations[bot.id].personality!]);
    expect(personalities(new Match(s))).toEqual(personalities(m));
    // the game's own stream is untouched
    expect(m.game.rng.next()).toBe(new Game(s).rng.next());
  });

  it('gives every bot its own deterministic random stream', () => {
    const draws = (m: Match): number[] => m.bots.map((bot) => bot.rng.next());
    const first = draws(new Match(setup()));
    expect(draws(new Match(setup()))).toEqual(first);
    expect(first[0]).not.toBe(first[1]);
    expect(draws(new Match(setup({ seed: 8 })))).not.toEqual(first);
  });
});

describe('Bot', () => {
  it('starts with an empty memory', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aa..'], nations: [{}] });
    const bot = new Bot(g, 1, 'hard', 'opportunist', 3);
    expect(bot.id).toBe(1);
    expect(bot.profile).toBe(DIFFICULTY.hard);
    expect(bot.weights).toBe(PERSONALITY.opportunist);
    expect(bot.memory).toEqual({
      lastBuildTick: -1e9, pendingAttack: null, lastProposalTick: -1e9, betrayTarget: null, focusTarget: null,
      lastNavalThreatTick: -1e9,
    });
  });

  it('issues no commands outside the playing phase', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aa..'], nations: [{ troops: 5000 }] });
    const bot = new EagerBot(g, 1, 'insane', 'aggressive', 3);
    expect(bot.think()).toEqual([{ type: 'debugGrant', nation: 1, gold: 1 }]);
    for (const phase of ['spawn', 'ended'] as const) {
      g.phase = phase;
      expect(bot.think()).toEqual([]);
    }
  });
});
