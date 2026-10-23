import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { Command, Difficulty, GameEvent, NationId, Relation } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { forEachNeighbor, isLand } from '../map/grid';
import { generateRandomMap } from '../map/randomMap';
import { Match } from '../match';
import { startAttack } from '../systems/attacks';
import { estimateConquest } from '../systems/combat';
import { declareWar } from '../systems/relations';
import { makeTestGame } from '../testing/fixtures';
import { Bot } from './bot';
import { attackBudget, chooseAttack, chooseAttacks, reserveNeeded, scoreTargets } from './military';
import { perceive } from './perception';
import type { NeighborInfo, Perception } from './perception';
import { DIFFICULTY } from './profile';
import type { DifficultyProfile } from './profile';

const SEED = 4242;
type AttackCommand = Extract<Command, { type: 'attack' }>;

/** A perception of a lone one-tile nation with `overrides` on top, for the pure sizing rules. */
function perception(overrides: Partial<Perception>): Perception {
  const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{}] });
  return { ...perceive(g, 1), ...overrides };
}

const neighbor = (id: NationId, relation: Relation, troops: number): NeighborInfo => ({
  id, sharedBorder: 1, troops, tiles: 10, density: troops / 10, relation, defense: 1, otherWars: 0, attackingMe: 0,
  buildings: 0,
});

/**
 * Checks that `cmd` is an attack by `me` on a land tile touching `me`'s land, and returns the nation it hits
 * (0 = unowned land).
 */
function targetOf(g: Game, cmd: Command | null | undefined, me: NationId): NationId {
  const attack = cmd as AttackCommand;
  expect(attack).toMatchObject({ type: 'attack', nation: me });
  expect(isLand(g.map, attack.tile)).toBe(true);
  let touchesMe = false;
  forEachNeighbor(g.map, attack.tile, (t) => {
    if (g.owner[t] === me) touchesMe = true;
  });
  expect(touchesMe).toBe(true);
  return g.owner[attack.tile];
}

/** The troops `cmd` would send from a pool of `troops`. */
const sent = (cmd: Command | null, troops: number): number => (cmd as AttackCommand).ratio * troops;

describe('reserveNeeded', () => {
  const { incomingReserve, strongNeutralShare } = CONFIG.ai;

  it('covers the incoming troops and a share of the strongest neighbour at war', () => {
    const p = perception({
      troops: 1000,
      incoming: 500,
      neighbors: [neighbor(2, 'war', 800), neighbor(3, 'war', 1200), neighbor(4, 'allied', 9000)],
    });
    expect(reserveNeeded(p, DIFFICULTY.easy)).toBeCloseTo(incomingReserve * 500, 10);
    expect(reserveNeeded(p, DIFFICULTY.normal)).toBeCloseTo(incomingReserve * 500 + 0.3 * 1200, 10);
    expect(reserveNeeded(p, DIFFICULTY.insane)).toBeCloseTo(incomingReserve * 500 + 0.6 * 1200, 10);
  });

  it('counts a neutral neighbour stronger than me at a share of its troops', () => {
    const { normal } = DIFFICULTY;
    const p = (...neighbors: NeighborInfo[]) => perception({ troops: 1000, neighbors });
    expect(reserveNeeded(p(neighbor(2, 'war', 300), neighbor(3, 'neutral', 5000)), normal))
      .toBeCloseTo(normal.reserveFactor * strongNeutralShare * 5000, 10);
    // the neighbour at war outweighs the neutral one's share
    expect(reserveNeeded(p(neighbor(2, 'war', 800), neighbor(3, 'neutral', 2000)), normal))
      .toBeCloseTo(normal.reserveFactor * 800, 10);
    // a neutral neighbour weaker than me is no threat
    expect(reserveNeeded(p(neighbor(3, 'neutral', 900)), normal)).toBe(0);
  });
});

describe('reserveNeeded cap', () => {
  it('never holds back more than reserveCap of the troop cap, however strong the enemy', () => {
    const p = perception({ troops: 1000, maxTroops: 1000, troopRatio: 1, neighbors: [neighbor(2, 'war', 1e6)] });
    expect(reserveNeeded(p, DIFFICULTY.insane)).toBeCloseTo(CONFIG.ai.reserveCap * 1000, 10);
    expect(attackBudget(p, DIFFICULTY.insane)).toBeCloseTo(1000 - CONFIG.ai.reserveCap * 1000, 10);
  });
});

describe('attackBudget', () => {
  const { normal } = DIFFICULTY; // band [0.5, 0.8]

  it('above the band, spends down to the band floor or the reserve, whichever is higher', () => {
    const p = perception({ troops: 4500, maxTroops: 5000, troopRatio: 0.9 });
    expect(attackBudget(p, normal)).toBeCloseTo(4500 - 0.5 * 5000, 10);

    const threatened = { ...p, incoming: 2500 };
    expect(reserveNeeded(threatened, normal)).toBeGreaterThan(0.5 * 5000);
    expect(attackBudget(threatened, normal)).toBeCloseTo(4500 - reserveNeeded(threatened, normal), 10);
  });

  it('within the band, sends a share of the troops above the band floor (or the reserve) into free land, and waits when none is free', () => {
    const { expandShare } = CONFIG.ai;
    const p = perception({ troops: 3500, maxTroops: 5000, troopRatio: 0.7, neutralBorder: 3 });
    expect(attackBudget(p, normal)).toBeCloseTo((3500 - 0.5 * 5000) * expandShare, 10);
    const threatened = { ...p, incoming: 2500 };
    expect(reserveNeeded(threatened, normal)).toBeGreaterThan(0.5 * 5000);
    expect(attackBudget(threatened, normal)).toBeCloseTo((3500 - reserveNeeded(threatened, normal)) * expandShare, 10);
    expect(attackBudget({ ...p, neutralBorder: 0 }, normal)).toBe(0);
  });

  it('below the band floor keeps every troop home, free land or not (troops far below the cap grow slowly)', () => {
    const p = perception({ troops: 2000, maxTroops: 5000, troopRatio: 0.4, neutralBorder: 3 });
    expect(attackBudget(p, normal)).toBe(0);
  });

  it('is never negative', () => {
    const within = perception({ troops: 3500, maxTroops: 5000, troopRatio: 0.7, neutralBorder: 3, incoming: 5000 });
    expect(attackBudget(within, normal)).toBe(0);
    // above the band the reserve is capped, so the top of the cap still goes
    const above = perception({ troops: 4500, maxTroops: 5000, troopRatio: 0.9, incoming: 5000 });
    expect(attackBudget(above, normal)).toBeCloseTo(4500 - CONFIG.ai.reserveCap * 5000, 10);
  });
});

describe('chooseAttack', () => {
  it('expands into neutral land when available', () => {
    // 3000 of a 5080 cap: inside normal's band
    const g = makeTestGame({ map: ['########'], owners: ['aa......'], nations: [{ troops: 3000 }] });
    const bot = new Bot(g, 1, 'normal', 'aggressive', SEED);
    const cmds = bot.think();
    expect(cmds).toEqual([{ type: 'attack', nation: 1, tile: 2, ratio: expect.any(Number) }]);
    const { ratio } = cmds[0] as AttackCommand;
    // paced: never more than the expansion budget
    expect(ratio).toBeLessThanOrEqual(CONFIG.ai.expandShare);
    expect(applyCommand(g, cmds[0])).toEqual({ ok: true });
    expect(g.attacks).toEqual([expect.objectContaining({ attacker: 1, target: 0, troops: Math.floor(3000 * ratio) })]);
  });

  it('picks the weaker of two neighbours', () => {
    // a sits between b and c, each holding three tiles
    for (const [bTroops, cTroops, weaker] of [[30, 15, 3], [15, 30, 2]]) {
      const g = makeTestGame({
        map: ['#########'],
        owners: ['bbbaaaccc'],
        nations: [{ troops: 4000 }, { troops: bTroops }, { troops: cTroops }],
      });
      const bot = new Bot(g, 1, 'insane', 'aggressive', SEED);
      const p = perceive(g, 1);
      const cmd = chooseAttack(g, p, bot);
      expect(targetOf(g, cmd, 1)).toBe(weaker);
      expect(sent(cmd, p.troops)).toBeGreaterThan(0);
      expect(sent(cmd, p.troops)).toBeLessThanOrEqual(attackBudget(p, bot.profile) + 1e-6);
    }
  });

  it('waits while troops are below the band and nothing is free', () => {
    const g = makeTestGame({
      map: ['#########'],
      owners: ['bbbaaaccc'],
      nations: [{ troops: 2000 }, { troops: 30 }, { troops: 15 }],
    });
    const bot = new Bot(g, 1, 'normal', 'aggressive', SEED);
    const [, upper] = DIFFICULTY.normal.troopBand;
    expect(perceive(g, 1).troopRatio).toBeLessThan(upper);
    expect(bot.think()).toEqual([]);

    g.nations[1].troops = 4500;
    expect(perceive(g, 1).troopRatio).toBeGreaterThan(upper);
    const [cmd] = bot.think();
    expect([2, 3]).toContain(targetOf(g, cmd, 1));
  });

  it('keeps the reserve when under attack', () => {
    // b throws 2000 of its 3000 troops at a; c is weak and neutral
    const g = makeTestGame({
      map: ['############'],
      owners: ['bbbbaaaacccc'],
      nations: [{ troops: 5000 }, { troops: 3000 }, { troops: 20 }],
    });
    expect(startAttack(g, 2, 1, 2000)).toEqual({ ok: true });
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    const p = perceive(g, 1);
    const reserve = reserveNeeded(p, bot.profile);
    // the reserve, not the troop band, is what limits the attack
    expect(reserve).toBeGreaterThan(bot.profile.troopBand[0] * p.maxTroops);

    const cmd = chooseAttack(g, p, bot);
    expect(targetOf(g, cmd, 1)).toBe(3);
    expect(sent(cmd, p.troops)).toBeLessThanOrEqual(p.troops - reserve + 1e-6);
    expect(sent(cmd, p.troops)).toBeGreaterThan(0);
    expect(applyCommand(g, cmd as Command)).toEqual({ ok: true });
    expect(g.nations[1].troops).toBeGreaterThanOrEqual(reserve - 1e-6);
  });

  it('counterattacks an incoming attack (normal+) but not on easy', () => {
    // b throws 500 of its 1500 troops at a, which also has free land on its right
    const underAttack = (): Game => {
      const g = makeTestGame({
        map: ['#########'],
        owners: ['bbbaaa...'],
        nations: [{ troops: 3000 }, { troops: 1500 }],
      });
      expect(startAttack(g, 2, 1, 500)).toEqual({ ok: true });
      return g;
    };
    for (const difficulty of ['normal', 'hard', 'insane'] as const) {
      const g = underAttack();
      const cmd = chooseAttack(g, perceive(g, 1), new Bot(g, 1, difficulty, 'builder', SEED));
      expect(targetOf(g, cmd, 1)).toBe(2);
      expect(sent(cmd, 3000)).toBeCloseTo(CONFIG.ai.counterattackFactor * 500, 6);
      expect(applyCommand(g, cmd as Command)).toEqual({ ok: true });
      // the counterattack wipes out b's attack
      expect(g.attacks.filter((a) => a.attacker === 2)).toEqual([]);
    }

    // easy doesn't hit back; below its band it holds every troop
    const g = underAttack();
    expect(chooseAttack(g, perceive(g, 1), new Bot(g, 1, 'easy', 'builder', SEED))).toBeNull();
  });

  it('counterattacks the largest incoming attack', () => {
    const g = makeTestGame({
      map: ['#########'],
      owners: ['bbbaaaccc'],
      nations: [{ troops: 3000 }, { troops: 1500 }, { troops: 1500 }],
    });
    expect(startAttack(g, 2, 1, 300)).toEqual({ ok: true });
    expect(startAttack(g, 3, 1, 500)).toEqual({ ok: true });
    const cmd = chooseAttack(g, perceive(g, 1), new Bot(g, 1, 'normal', 'builder', SEED));
    expect(targetOf(g, cmd, 1)).toBe(3);
    expect(sent(cmd, 3000)).toBeCloseTo(CONFIG.ai.counterattackFactor * 500, 6);
  });

  it('never targets an ally', () => {
    // a's allied neighbour b is the weakest; c and the free land below are the other options
    const g = makeTestGame({
      map: ['###############', '###############'],
      owners: ['bbbbbbaaacccccc', '...............'],
      nations: [{ troops: 5000 }, { troops: 30 }, { troops: 60 }],
    });
    g.relations.set(1, 2, 'allied');
    // easy's mistakes make it take the second-best option a quarter of the time
    const bot = new Bot(g, 1, 'easy', 'aggressive', SEED);
    const p = perceive(g, 1);
    const targets = new Set<NationId>();
    for (let i = 0; i < 200; i++) targets.add(targetOf(g, chooseAttack(g, p, bot), 1));
    expect([...targets].sort()).toEqual([0, 3]);

    // unless it means to betray it
    bot.memory.betrayTarget = 2;
    expect(scoreTargets(g, p, bot).map((s) => s.target)).toContain(2);
  });

  it('avoids opening a second front when an equal option exists', () => {
    // b and c are alike, but a is already at war with c
    const g = makeTestGame({
      map: ['###############'],
      owners: ['bbbbbbaaacccccc'],
      nations: [{ troops: 5000 }, { troops: 30 }, { troops: 30 }],
    });
    declareWar(g, 1, 3);
    const bot = new Bot(g, 1, 'normal', 'aggressive', SEED);
    const p = perceive(g, 1);
    for (let i = 0; i < 20; i++) expect(scoreTargets(g, p, bot).map((s) => s.target)).toEqual([3, 2]);
  });

  it('hard bot gangs up on the leader over a slightly weaker non-leader', () => {
    // b leads with 14 of the 24 tiles at density 10; c is a little thinner at density 7
    const g = makeTestGame({
      map: ['#'.repeat(24)],
      owners: ['b'.repeat(14) + 'aaaa' + 'c'.repeat(6)],
      nations: [{ troops: 5000 }, { troops: 140 }, { troops: 42 }],
    });
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    const p = perceive(g, 1);
    expect(p).toMatchObject({ leader: 2 });
    expect(p.leaderShare).toBeGreaterThan(CONFIG.ai.gangUpShare);
    for (let i = 0; i < 20; i++) expect(scoreTargets(g, p, bot)[0].target).toBe(2);

    // with the leader short of the gang-up share, the weaker neighbour comes first
    const calm = { ...p, leaderShare: CONFIG.ai.gangUpShare };
    for (let i = 0; i < 20; i++) expect(scoreTargets(g, calm, bot)[0].target).toBe(3);
  });

  it('insane discounts a target by the share of land another war could take while the troops sent are away', () => {
    // a is at war with b; c is weak and neutral
    const g = makeTestGame({
      map: ['#'.repeat(22)],
      owners: ['bbbbbb' + 'a'.repeat(10) + 'cccccc'],
      nations: [{ troops: 5000 }, { troops: 600 }, { troops: 30 }],
    });
    declareWar(g, 1, 2);
    const p = perceive(g, 1);
    const insane = new Bot(g, 1, 'insane', 'aggressive', SEED);
    const blind = new Bot(g, 1, 'insane', 'aggressive', SEED);
    (blind as { profile: DifficultyProfile }).profile = { ...DIFFICULTY.insane, lookahead: false };
    const score = (bot: Bot, t: NationId) => scoreTargets(g, p, bot).find((s) => s.target === t)!;
    // b is the war itself: no discount there
    expect(score(insane, 2).score).toBeCloseTo(score(blind, 2).score, 10);
    // c is discounted by the share of a's land b could take with c's troops away
    const away = score(insane, 3).troops;
    expect(away).toBe(score(blind, 3).troops);
    const taken = estimateConquest(g, 2, 1, 600, { defenderTroops: p.troops - away }).tiles;
    expect(taken).toBeGreaterThan(0);
    expect(estimateConquest(g, 2, 1, 600).tiles).toBeLessThanOrEqual(taken);
    expect(score(insane, 3).score)
      .toBeCloseTo(score(blind, 3).score * (1 - (taken / p.tiles) * CONFIG.ai.counterRiskWeight), 10);
    expect(score(insane, 3).score).toBeLessThan(score(blind, 3).score);
  });

  it('takes the second-best target about mistakeChance of the time', () => {
    // free land is by far the best option; b is the second best
    const g = makeTestGame({
      map: ['#########', '#########'],
      owners: ['aaabbbbbb', '.........'],
      nations: [{ troops: 5000 }, { troops: 60 }],
    });
    const p = perceive(g, 1);
    const picks = (difficulty: Difficulty, n: number): number => {
      const bot = new Bot(g, 1, difficulty, 'aggressive', SEED);
      let second = 0;
      for (let i = 0; i < n; i++) if (targetOf(g, chooseAttack(g, p, bot), 1) === 2) second++;
      return second;
    };
    const n = 400;
    const share = picks('easy', n) / n;
    expect(share).toBeGreaterThan(DIFFICULTY.easy.mistakeChance - 0.1);
    expect(share).toBeLessThan(DIFFICULTY.easy.mistakeChance + 0.1);
    expect(picks('insane', 100)).toBe(0);
  });
});

describe('attack pacing', () => {
  it('commits no more troops than an attack can use before the next decisions', () => {
    // a long open plain: the attack can only take a few tiles per tick (troops above the band, short of saturated)
    const g = makeTestGame({ map: ['#'.repeat(200)], owners: ['aa' + '.'.repeat(198)], nations: [{ troops: 4400 }] });
    const bot = new Bot(g, 1, 'insane', 'aggressive', SEED);
    const [first] = scoreTargets(g, perceive(g, 1), bot);
    expect(first.target).toBe(0);
    const { frontFraction, minTilesPerTick, terrainCost, neutralCost } = CONFIG.combat;
    const perTick = Math.max(minTilesPerTick, 1 * frontFraction);
    const useful = perTick * bot.profile.reactionTicks * CONFIG.ai.paceMargin * terrainCost[1] * neutralCost;
    expect(first.troops).toBeCloseTo(useful, 6);
  });

  it('spreads a budget one front cannot absorb over several targets', () => {
    // a holds far more than an attack on either side can use: free land to the right, weak b to the left
    const g = makeTestGame({
      map: ['#'.repeat(60), '#'.repeat(60)],
      owners: ['b'.repeat(10) + 'a'.repeat(10) + '.'.repeat(40), 'b'.repeat(10) + 'a'.repeat(10) + '.'.repeat(40)],
      nations: [{ troops: 100_000 }, { troops: 100 }],
    });
    const p = perceive(g, 1);
    // chooseAttack is the first of them
    const first = chooseAttack(g, p, new Bot(g, 1, 'insane', 'aggressive', SEED));
    const cmds = chooseAttacks(g, p, new Bot(g, 1, 'insane', 'aggressive', SEED));
    expect(cmds[0]).toEqual(first);
    expect(cmds.map((c) => targetOf(g, c, 1)).sort()).toEqual([0, 2]);
    const total = cmds.reduce((sum, c) => sum + sent(c, p.troops), 0);
    expect(total).toBeLessThanOrEqual(attackBudget(p, DIFFICULTY.insane) + 1e-6);
    for (const c of cmds) expect(applyCommand(g, c)).toEqual({ ok: true });
  });

  it('tops up a running attack only to what it can use', () => {
    const g = makeTestGame({ map: ['#'.repeat(200)], owners: ['aa' + '.'.repeat(198)], nations: [{ troops: 4400 }] });
    const bot = new Bot(g, 1, 'insane', 'aggressive', SEED);
    const [cmd] = bot.think();
    expect(applyCommand(g, cmd)).toEqual({ ok: true });
    // the attack already holds all it can use: nothing more goes in
    expect(scoreTargets(g, perceive(g, 1), bot).find((s) => s.target === 0)).toBeUndefined();
  });
});

describe('surplus troops', () => {
  it('above the band, takes any gain however costly; within it, not below minAttackScore', () => {
    // b is packed with troops: taking a tile costs far more troops than minAttackScore allows
    const g = makeTestGame({ map: ['#'.repeat(12)], owners: ['aaaaaabbbbbb'], nations: [{ troops: 5000 }, { troops: 5000 }] });
    g.nations[2].tiles = 6;
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    const p = perceive(g, 1);
    expect(p.troopRatio).toBeGreaterThan(bot.profile.troopBand[1]);
    const [s] = scoreTargets(g, p, bot);
    expect(s).toMatchObject({ target: 2 });
    expect(s.score).toBeLessThan(CONFIG.ai.minAttackScore);
    // within the band the same target isn't worth it
    const within = { ...p, troopRatio: 0.5, troops: 0.5 * p.maxTroops, neutralBorder: 1 };
    expect(scoreTargets(g, within, bot).find((x) => x.target === 2)).toBeUndefined();
  });

  it('saturated (≥ saturatedRatio of the cap), sends at least a share of the budget per target instead of pacing', () => {
    const g = makeTestGame({ map: ['#'.repeat(200)], owners: ['aa' + '.'.repeat(198)], nations: [{ troops: 100_000 }] });
    const bot = new Bot(g, 1, 'insane', 'aggressive', SEED);
    const p = perceive(g, 1);
    expect(p.troopRatio).toBeGreaterThan(CONFIG.ai.saturatedRatio);
    const [first] = scoreTargets(g, p, bot);
    expect(first.troops).toBeCloseTo(attackBudget(p, bot.profile) / CONFIG.ai.maxAttacksPerThink, 6);
  });
});

describe('bots in a match', () => {
  it('fight over land and each other without a rejected command', () => {
    const levels: Difficulty[] = ['normal', 'normal', 'hard', 'hard', 'insane', 'insane'];
    const m = new Match({
      map: generateRandomMap(SEED, 'small'),
      seed: SEED,
      player: null,
      bots: levels.map((difficulty) => ({ difficulty })),
      spawnTicks: 1,
      checkVictory: false,
    });
    const rejected: GameEvent[] = [];
    let attacksOnNations = 0;
    for (let i = 0; i < 1500; i++) {
      m.step();
      for (const e of m.game.drainEvents()) {
        if (e.type === 'rejected' && m.game.nations[e.nation]?.difficulty != null) rejected.push(e);
        if (e.type === 'attackStarted' && e.target !== 0) attacksOnNations++;
      }
    }
    expect(rejected).toEqual([]);
    expect(attacksOnNations).toBeGreaterThan(0);
  }, 30_000);
});
