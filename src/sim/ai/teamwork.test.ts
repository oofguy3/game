import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import { DEFAULT_RULES } from '../../shared/rules';
import type { Command, DiplomacyRequest, GameEvent, Personality } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import type { Nation } from '../core/nation';
import { generateRandomMap } from '../map/randomMap';
import { Match } from '../match';
import { buildingCost } from '../systems/buildings';
import { maxTroops } from '../systems/economy';
import { makeTestGame } from '../testing/fixtures';
import { Rng } from '../util/rng';
import { Bot } from './bot';
import { evaluateRequest } from './diplomacy';
import { rankBuilds } from './economy';
import { attackBudget, frontierTile, reserveNeeded, scoreTargets } from './military';
import { perceive } from './perception';
import { DIFFICULTY, PERSONALITIES, PERSONALITY } from './profile';
import { answerAid, teamHelp } from './teamwork';

const SEED = 41;
const T = CONFIG.teams;
const LONG_AGO = -1e9;

/** Three rows of `row` (`a` is nation 1, `b` 2, …), every nation's fields overridden by `nations`, on `teams`. */
function game(row: string, nations: Partial<Nation>[], teams?: number[]): Game {
  return makeTestGame({
    map: [0, 1, 2].map(() => '#'.repeat(row.length)),
    owners: [0, 1, 2].map(() => row),
    nations,
    teams,
  });
}

const tileOf = (g: Game, nation: number): number => g.owner.indexOf(nation);
/** Nation `from` attacks nation `to` with half its troops. */
const attack = (g: Game, from: number, to: number): void => {
  expect(applyCommand(g, { type: 'attack', nation: from, tile: tileOf(g, to), ratio: 0.5 })).toEqual({ ok: true });
  g.drainEvents();
};
const bot = (g: Game, spirit: number, personality: Personality = 'builder'): Bot => {
  const b = new Bot(g, 1, 'hard', personality, SEED);
  b.teamSpirit = spirit;
  return b;
};
const help = (g: Game, b: Bot): Command[] => teamHelp(g, perceive(g, 1), b);

/** a | c | b: c (another team) attacks b, a's teammate, and borders a. */
function hitBack(): Game {
  const g = game('aaaaccccbbbb', [{ troops: 5000, gold: 0 }, { troops: 1000 }, { troops: 3000 }], [1, 1, 2]);
  attack(g, 3, 2);
  return g;
}

/** The help attack nation 1 (hard) makes now on `target` for `ally`: half its attack budget, at their front. */
function helpAttack(g: Game, target: number, ally: number, kind: 'join' | 'defend'): Command {
  const p = perceive(g, 1);
  const ratio = (T.helpBudgetShare * attackBudget(p, DIFFICULTY.hard)) / p.troops;
  return { type: 'attack', nation: 1, tile: frontierTile(g, 1, target)!, ratio, support: { ally, kind } };
}

/** An ask for `resource` from `from` to nation 1, made as a command. */
function ask(g: Game, from: number, resource: 'troops' | 'gold'): DiplomacyRequest {
  expect(applyCommand(g, { type: 'askAid', nation: from, to: 1, resource })).toEqual({ ok: true });
  g.drainEvents();
  return [...g.requests.values()].find((r) => r.from === from && r.kind === 'aid')!;
}

/** The troops or gold `p.me` gives: `share` of `have`, never dipping below `keep`. */
const gift = (have: number, keep: number, share: number): number => Math.floor(Math.min(share * have, have - keep));

describe('team spirit', () => {
  it('team spirit follows the personality, within ±0.1 per bot', () => {
    const base = Object.fromEntries(PERSONALITIES.map((k) => [k, PERSONALITY[k].teamSpirit]));
    expect(base).toEqual({ aggressive: 0.4, builder: 0.6, trader: 0.75, opportunist: 0.25, diplomat: 0.9 });
    const g = makeTestGame({ map: ['####'], nations: Array.from({ length: 40 }, () => ({})) });
    for (const personality of PERSONALITIES) {
      const offsets = new Set<number>();
      for (let id = 1; id <= 40; id++) {
        const b = new Bot(g, id, 'hard', personality, SEED);
        const offset = b.teamSpirit - PERSONALITY[personality].teamSpirit;
        expect(Math.abs(offset)).toBeLessThanOrEqual(T.spiritJitter);
        // the offset comes from the bot's own teamwork stream, salted 3000 + id
        expect(offset).toBeCloseTo((new Rng(SEED).fork(3000 + id).next() * 2 - 1) * T.spiritJitter, 12);
        // which leaves the bot's main stream as it was
        expect(b.rng.next()).toBe(new Rng(SEED).fork(1000 + id).next());
        offsets.add(offset);
      }
      expect(offsets.size).toBe(40);
    }
  });
});

describe('helping on its own', () => {
  it('hit back: the bot attacks whoever attacks its teammate, when the roll succeeds', () => {
    const g = hitBack();
    const b = bot(g, 1);
    const expected = helpAttack(g, 3, 2, 'defend');
    const cmds = help(g, b);
    expect(cmds).toEqual([expected]);
    expect(b.memory.lastHelpCheck).toBe(g.tick);
    // the support is echoed when the attack starts
    expect(applyCommand(g, cmds[0])).toEqual({ ok: true });
    expect(g.drainEvents()).toContainEqual({
      type: 'attackStarted', attacker: 1, target: 3, troops: Math.floor(5000 * (expected as { ratio: number }).ratio),
      support: { ally: 2, kind: 'defend' },
    });
  });

  it('support is echoed only for a living teammate; otherwise the attack goes ahead without it', () => {
    const started = (g: Game, support: unknown): GameEvent[] => {
      const cmd = { type: 'attack', nation: 1, tile: tileOf(g, 3), ratio: 0.1, support } as Command;
      expect(applyCommand(g, cmd)).toEqual({ ok: true });
      return g.drainEvents().filter((e) => e.type === 'attackStarted');
    };
    const plain = { type: 'attackStarted', attacker: 1, target: 3, troops: 500 };
    const g = hitBack();
    expect(started(g, { ally: 2, kind: 'join' })).toEqual([{ ...plain, support: { ally: 2, kind: 'join' } }]);
    for (const bad of [{ ally: 3, kind: 'join' }, { ally: 1, kind: 'defend' }, { ally: 99, kind: 'join' },
      { ally: 2, kind: 'cheer' }, { ally: '2', kind: 'join' }, null, 7]) {
      const fresh = hitBack();
      const events = started(fresh, bad);
      expect(events).toEqual([plain]);
      expect(events[0]).not.toHaveProperty('support');
    }
    const dead = hitBack();
    dead.nations[2].alive = false;
    expect(started(dead, { ally: 2, kind: 'defend' })).toEqual([plain]);
    // no teammates in free-for-all, allies or not
    const ffa = game('aaaaccccbbbb', [{ troops: 5000, gold: 0 }, { troops: 1000 }, { troops: 3000 }]);
    ffa.relations.set(1, 2, 'allied');
    expect(started(ffa, { ally: 2, kind: 'defend' })).toEqual([plain]);
  });

  it('help attacks get half of what the budget has left', () => {
    const g = hitBack();
    const p = perceive(g, 1);
    const spent = attackBudget(p, DIFFICULTY.hard) / 2;
    const [cmd] = teamHelp(g, p, bot(g, 1), spent);
    expect(cmd).toMatchObject({ type: 'attack', support: { ally: 2, kind: 'defend' } });
    expect((cmd as { ratio: number }).ratio).toBeCloseTo((T.helpBudgetShare * spent) / p.troops, 12);
    // with nothing left of the budget there is nothing to attack with (and b has troops enough not to need aid)
    g.nations[2].troops = 5000;
    expect(teamHelp(g, perceive(g, 1), bot(g, 1), 2 * spent)).toEqual([]);
  });

  it('no help when the rolls fail', () => {
    // b is under attack by a's neighbour and low on troops: hit back and aid would both do
    const g = hitBack();
    expect(g.nations[2].troops).toBeLessThan(T.aidLowTroops * maxTroops(g, g.nations[2]));
    const b = bot(g, 0);
    expect(help(g, b)).toEqual([]);
    // the check still counts
    expect(b.memory.lastHelpCheck).toBe(g.tick);
  });

  it("gang up: the bot joins its teammate's attack on a nation next to it", () => {
    // a | c | b: b, a's teammate, attacks c, a's neighbour
    const g = game('aaaaccccbbbb', [{ troops: 5000, gold: 0 }, { troops: 3000 }, { troops: 1000 }], [1, 1, 2]);
    attack(g, 2, 3);
    // 1.25 × 0.8 ≥ 1: the roll can't fail
    expect(help(g, bot(g, 1.25))).toEqual([helpAttack(g, 3, 2, 'join')]);
    expect(help(g, bot(g, 0))).toEqual([]);
  });

  it('aid: a teammate under attack below 25% of its limit gets up to 20% of the troops above the reserve', () => {
    // a | b | c: c attacks b, a's teammate, but doesn't border a
    const g = game('aaaabbbbcccc', [{ troops: 5000, gold: 0 }, { troops: 1000 }, { troops: 4000 }], [1, 1, 2]);
    attack(g, 3, 2);
    expect(g.nations[2].troops).toBeLessThan(T.aidLowTroops * maxTroops(g, g.nations[2]));
    // 2 × 0.6 ≥ 1: the roll can't fail
    expect(help(g, bot(g, 2))).toEqual([{ type: 'sendAid', nation: 1, to: 2, gold: 0, troops: 1000 }]);
    expect(help(g, bot(g, 0))).toEqual([]);
    // a teammate with troops to spare gets none
    g.nations[2].troops = T.aidLowTroops * maxTroops(g, g.nations[2]);
    expect(help(g, bot(g, 2))).toEqual([]);
  });

  it('aid never dips below the reserve', () => {
    // d | a | b | c: a is at war with d, which is strong; c attacks b
    const nations = (a: number): Partial<Nation>[] => [
      { troops: a, gold: 0 }, { troops: 1000 }, { troops: 4000 }, { troops: 9000 },
    ];
    const g = game('ddaaaabbbbcccc', nations(5000), [1, 1, 2, 2]);
    g.relations.set(1, 4, 'war');
    attack(g, 3, 2);
    const p = perceive(g, 1);
    const reserve = reserveNeeded(p, DIFFICULTY.hard);
    const troops = gift(p.troops, reserve, T.aidTroopShare);
    expect(troops).toBeLessThan(T.aidTroopShare * p.troops);
    expect(troops).toBeGreaterThanOrEqual(1);
    expect(help(g, bot(g, 2))).toEqual([{ type: 'sendAid', nation: 1, to: 2, gold: 0, troops }]);
    // nothing above the reserve: nothing to send
    const poor = game('ddaaaabbbbcccc', nations(3000), [1, 1, 2, 2]);
    poor.relations.set(1, 4, 'war');
    attack(poor, 3, 2);
    expect(reserveNeeded(perceive(poor, 1), DIFFICULTY.hard)).toBeGreaterThan(3000);
    expect(help(poor, bot(poor, 2))).toEqual([]);
  });

  it('the bot helps on its own at most once every 100 ticks', () => {
    const g = hitBack();
    const b = bot(g, 1);
    expect(help(g, b)).toHaveLength(1);
    g.tick += T.helpCheckTicks - 1;
    expect(help(g, b)).toEqual([]);
    g.tick += 1;
    expect(help(g, b)).toHaveLength(1);
    // a check whose rolls fail counts too
    b.teamSpirit = 0;
    g.tick += T.helpCheckTicks;
    expect(help(g, b)).toEqual([]);
    b.teamSpirit = 1;
    g.tick += T.helpCheckTicks - 1;
    expect(help(g, b)).toEqual([]);
  });

  it('free-for-all bots never run teamwork', () => {
    // the hit-back layout with b an ally, but no teams
    const g = game('aaaaccccbbbb', [{ troops: 5000, gold: 0 }, { troops: 1000 }, { troops: 3000 }]);
    g.relations.set(1, 2, 'allied');
    attack(g, 3, 2);
    const b = bot(g, 2);
    expect(help(g, b)).toEqual([]);
    expect(b.memory.lastHelpCheck).toBe(LONG_AGO);
  });
});

describe('answering asks', () => {
  /** a | b on one team, with c and d on the other: `c` borders a. */
  const team = (a: Partial<Nation> = {}, c: Partial<Nation> = {}): Game => game(
    'ccccaaaabbbbdddd',
    [{ troops: 5000, gold: 5000, ...a }, { troops: 1000 }, { troops: 1000, ...c }, { troops: 1000 }],
    [1, 1, 2, 2],
  );
  const yes = (req: DiplomacyRequest, gold: number, troops: number): Command[] => [
    { type: 'sendAid', nation: 1, to: req.from, gold, troops },
    { type: 'respond', nation: 1, requestId: req.id, accept: true },
  ];
  const no = (req: DiplomacyRequest, reason: 'busy' | 'cantSpare' | 'notNow'): Command[] => [
    { type: 'respond', nation: 1, requestId: req.id, accept: false, reason },
  ];
  const answer = (g: Game, b: Bot, req: DiplomacyRequest): Command[] => answerAid(g, perceive(g, 1), b, req);

  it('answers to asks: yes sends troops or gold; no says busy, cantSpare or notNow', () => {
    const g = team();
    const troops = ask(g, 2, 'troops');
    expect(answer(g, bot(g, 2), troops)).toEqual(yes(troops, 0, 1000));
    g.requests.clear();
    g.asks.clear();
    const gold = ask(g, 2, 'gold');
    const p = perceive(g, 1);
    const cost = buildingCost(g, 1, rankBuilds(g, p, bot(g, 2))[0].type);
    expect(answer(g, bot(g, 2), gold)).toEqual(yes(gold, gift(5000, cost, T.aidGoldShare), 0));
    // the roll under team spirit fails
    expect(answer(g, bot(g, 0), gold)).toEqual(no(gold, 'notNow'));

    // nothing above the building it saves for
    const broke = team({ gold: cost - 1 });
    const brokeAsk = ask(broke, 2, 'gold');
    expect(answer(broke, bot(broke, 2), brokeAsk)).toEqual(no(brokeAsk, 'cantSpare'));
    // nothing above the reserve: at war with a strong neighbour, though not under attack
    const thin = team({ troops: 3000 }, { troops: 9000 });
    thin.relations.set(1, 3, 'war');
    expect(reserveNeeded(perceive(thin, 1), DIFFICULTY.hard)).toBeGreaterThan(3000);
    const thinAsk = ask(thin, 2, 'troops');
    expect(answer(thin, bot(thin, 2), thinAsk)).toEqual(no(thinAsk, 'cantSpare'));
    // at war and losing ground: busy, whatever it could spare
    const busy = team({}, { troops: 9000 });
    attack(busy, 3, 1);
    expect(perceive(busy, 1).incoming).toBeGreaterThan(T.busyIncomingShare * 5000);
    const busyAsk = ask(busy, 2, 'gold');
    expect(answer(busy, bot(busy, 2), busyAsk)).toEqual(no(busyAsk, 'busy'));
  });

  it('asks are answered when the bot thinks, and the answers go through', () => {
    const g = team({ gold: 0 });
    const req = ask(g, 2, 'troops');
    const b = bot(g, 2);
    const cmds = b.think();
    expect(cmds.slice(0, 2)).toEqual(yes(req, 0, 1000));
    for (const cmd of cmds.slice(0, 2)) expect(applyCommand(g, cmd)).toEqual({ ok: true });
    expect(g.drainEvents()).toEqual([
      { type: 'aidSent', from: 1, to: 2, gold: 0, troops: 1000 },
      { type: 'requestResolved', requestId: req.id, kind: 'aid', from: 2, to: 1, accepted: true },
    ]);
    // a no carries its reason
    g.tick += T.askCooldownTicks;
    const nope = ask(g, 2, 'gold');
    expect(bot(g, 2).think().filter((c) => c.type === 'respond')).toEqual(no(nope, 'cantSpare'));
  });

  it("answers to asks don't count toward the help limit", () => {
    const g = hitBack();
    const req = ask(g, 2, 'troops');
    const b = bot(g, 2);
    expect(answer(g, b, req)).toHaveLength(2);
    expect(b.memory.lastHelpCheck).toBe(LONG_AGO);
    expect(help(g, b)).toHaveLength(1);
    // and helping doesn't hold back an answer
    expect(answer(g, b, req)).toHaveLength(2);
  });

  it('troops and gold the bot gives away come off what it decides later in the same think', () => {
    // two teammates ask at once: the second gift is a share of what the first left
    const g = game('ccccaaaabbbb', [{ troops: 5000, gold: 0 }, { troops: 1000 }, { troops: 1000 }], [1, 1, 1]);
    const first = ask(g, 2, 'troops');
    const second = ask(g, 3, 'troops');
    const cmds = bot(g, 2).think();
    expect(cmds.slice(0, 4)).toEqual([...yes(first, 0, 1000), ...yes(second, 0, 800)]);
    const rich = game('ccccaaaabbbb', [{ troops: 5000, gold: 5000 }, { troops: 1000 }, { troops: 1000 }], [1, 1, 1]);
    const cost = buildingCost(rich, 1, rankBuilds(rich, perceive(rich, 1), bot(rich, 2))[0].type);
    const one = ask(rich, 2, 'gold');
    const two = ask(rich, 3, 'gold');
    const firstGold = gift(5000, cost, T.aidGoldShare);
    expect(bot(rich, 2).think().slice(0, 4)).toEqual([
      ...yes(one, firstGold, 0), ...yes(two, gift(5000 - firstGold, cost, T.aidGoldShare), 0),
    ]);

    // the attacks that follow are those of a bot that has the troops it gave away no more
    const land = (troops: number): Game => makeTestGame({
      map: [0, 1, 2].map(() => '#'.repeat(16)),
      owners: [0, 1, 2].map(() => '........aaaabbbb'),
      nations: [{ troops, gold: 0 }, { troops: 1000 }],
      teams: [1, 1],
    });
    const asked = land(5000);
    ask(asked, 2, 'troops');
    const after = bot(asked, 2).think();
    expect(after.slice(0, 1)).toEqual([{ type: 'sendAid', nation: 1, to: 2, gold: 0, troops: 1000 }]);
    const rest = after.slice(2);
    expect(rest.some((c) => c.type === 'attack')).toBe(true);
    expect(rest).toEqual(bot(land(4000), 2).think());
  });
});

describe('calls to attack from teammates', () => {
  it('a teammate needs only jointAttackShare × (1 − jointEase × team spirit) of the best score', () => {
    // c | a | d over a row of b: c is weak (a's best target), d stronger; b, a's teammate, asks a to attack d
    const g = makeTestGame({
      map: [0, 1, 2].map(() => '#'.repeat(12)),
      owners: ['ccccaaaadddd', 'ccccaaaadddd', 'bbbbbbbbbbbb'],
      nations: [{ troops: 5000, gold: 0 }, { troops: 3000 }, { troops: 100 }, { troops: 400 }],
      teams: [1, 1, 2, 2],
    });
    const insane = (spirit: number): Bot => {
      const b = new Bot(g, 1, 'insane', 'builder', SEED);
      b.teamSpirit = spirit;
      return b;
    };
    const scores = scoreTargets(g, perceive(g, 1), insane(0));
    const best = scores[0];
    const theirs = scores.find((s) => s.target === 4)!;
    expect(best.target).toBe(3);
    const share = theirs.score / best.score;
    expect(share).toBeLessThan(CONFIG.ai.jointAttackShare);
    // the spirit at which d's score just meets the eased requirement
    const needed = (1 - share / CONFIG.ai.jointAttackShare) / T.jointEase;
    const req = (): DiplomacyRequest => {
      g.requests.clear();
      g.asks.clear();
      expect(applyCommand(g, { type: 'requestJointAttack', nation: 2, to: 1, target: 4 })).toEqual({ ok: true });
      g.drainEvents();
      return [...g.requests.values()][0];
    };
    expect(evaluateRequest(g, perceive(g, 1), insane(0), req())).toBe(false);
    expect(evaluateRequest(g, perceive(g, 1), insane(needed - 0.01), req())).toBe(false);
    const eager = insane(needed + 0.01);
    expect(evaluateRequest(g, perceive(g, 1), eager, req())).toBe(true);
    expect(eager.memory.focusTarget).toBe(4);
  });
});

describe('teams matches', () => {
  it('a teams match replays identically from the same seed', () => {
    const run = (): { owner: number[]; events: string[] } => {
      const m = new Match({
        map: generateRandomMap(5, 'small'),
        seed: 5,
        player: null,
        bots: Array.from({ length: 8 }, () => ({ difficulty: 'hard' as const })),
        spawnTicks: 1,
        rules: { ...DEFAULT_RULES, mode: 'teams', teams: 2 },
      });
      const events: string[] = [];
      for (let i = 0; i < 400; i++) {
        m.step();
        events.push(JSON.stringify(m.game.drainEvents()));
      }
      return { owner: [...m.game.owner], events };
    };
    const first = run();
    const second = run();
    expect(second.owner).toEqual(first.owner);
    expect(second.events).toEqual(first.events);
  }, 60_000);
});
