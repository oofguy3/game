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
import { attackBudget, chooseAttack, reserveNeeded, scoreTargets } from './military';
import { perceive } from './perception';
import type { NeighborInfo, Perception } from './perception';
import { DIFFICULTY, PERSONALITY } from './profile';

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

describe('attackBudget', () => {
  const { normal } = DIFFICULTY; // band [0.5, 0.8]

  it('above the band, spends down to the band floor or the reserve, whichever is higher', () => {
    const p = perception({ troops: 4500, maxTroops: 5000, troopRatio: 0.9 });
    expect(attackBudget(p, normal)).toBeCloseTo(4500 - 0.5 * 5000, 10);

    const threatened = { ...p, incoming: 2500 };
    expect(reserveNeeded(threatened, normal)).toBeGreaterThan(0.5 * 5000);
    expect(attackBudget(threatened, normal)).toBeCloseTo(4500 - reserveNeeded(threatened, normal), 10);
  });

  it('within the band, sends a share of the troops above the reserve into free land, and waits when none is free', () => {
    const { expandShare } = CONFIG.ai;
    const p = perception({ troops: 2000, maxTroops: 5000, troopRatio: 0.4, neutralBorder: 3 });
    expect(attackBudget(p, normal)).toBeCloseTo(2000 * expandShare, 10);
    const threatened = { ...p, incoming: 500 };
    expect(attackBudget(threatened, normal)).toBeCloseTo((2000 - reserveNeeded(threatened, normal)) * expandShare, 10);
    expect(attackBudget({ ...p, neutralBorder: 0 }, normal)).toBe(0);
  });

  it('is never negative', () => {
    const within = perception({ troops: 2000, maxTroops: 5000, troopRatio: 0.4, neutralBorder: 3, incoming: 5000 });
    expect(attackBudget(within, normal)).toBe(0);
    const above = perception({ troops: 4500, maxTroops: 5000, troopRatio: 0.9, incoming: 5000 });
    expect(attackBudget(above, normal)).toBe(0);
  });
});

describe('chooseAttack', () => {
  it('expands into neutral land when available', () => {
    const g = makeTestGame({ map: ['########'], owners: ['aa......'], nations: [{ troops: 1000 }] });
    const bot = new Bot(g, 1, 'normal', 'aggressive', SEED);
    const cmds = bot.think();
    expect(cmds).toEqual([{ type: 'attack', nation: 1, tile: 2, ratio: CONFIG.ai.expandShare }]);
    expect(applyCommand(g, cmds[0])).toEqual({ ok: true });
    expect(g.attacks).toEqual([expect.objectContaining({ attacker: 1, target: 0, troops: 500 })]);
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
      expect(sent(cmd, p.troops)).toBeCloseTo(attackBudget(p, bot.profile), 6);
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
    expect(sent(cmd, p.troops)).toBeCloseTo(p.troops - reserve, 6);
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

    const g = underAttack();
    const cmd = chooseAttack(g, perceive(g, 1), new Bot(g, 1, 'easy', 'builder', SEED));
    expect(targetOf(g, cmd, 1)).toBe(0);
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

  it('insane weighs the land another war could take while its troops are away', () => {
    // a is at war with b; with a's troops at home b can't take a tile, but with the attack budget gone it can
    const g = makeTestGame({
      map: ['#'.repeat(22)],
      owners: ['bbbbbb' + 'a'.repeat(10) + 'cccccc'],
      nations: [{ troops: 5000 }, { troops: 600 }, { troops: 30 }],
    });
    declareWar(g, 1, 2);
    const p = perceive(g, 1);
    const insane = new Bot(g, 1, 'insane', 'aggressive', SEED);
    const budget = attackBudget(p, insane.profile);
    expect(estimateConquest(g, 2, 1, 600).tiles).toBe(0);
    expect(estimateConquest(g, 2, 1, 600, { defenderTroops: p.troops - budget }).tiles).toBeGreaterThan(0);

    // insane stays on its one front: b's own threat doesn't count against attacking b
    const scores = scoreTargets(g, p, insane);
    expect(scores.map((s) => s.target)).toEqual([2]);
    const est = estimateConquest(g, 1, 2, budget);
    const { aggression, opportunism } = PERSONALITY.aggressive;
    const sparser = 0.3; // b is thinner than a
    expect(scores[0].score).toBeCloseTo(est.tiles / est.attackerLoss * aggression * (1 + opportunism * sparser), 10);
    expect(scores[0].troops).toBeCloseTo(budget, 10);

    // hard looks no further than the targets themselves and prefers weak c
    const hard = new Bot(g, 1, 'hard', 'aggressive', SEED);
    expect(scoreTargets(g, p, hard).map((s) => s.target)).toEqual([3, 2]);
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
