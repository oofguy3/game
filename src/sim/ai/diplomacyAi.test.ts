import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { MatchRules } from '../../shared/rules';
import type { Command, Deal, Difficulty, DiplomacyRequest, GameEvent, Personality } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { generateRandomMap } from '../map/randomMap';
import { Match } from '../match';
import { createRequest } from '../systems/diplomacy';
import { makeTestGame } from '../testing/fixtures';
import { Bot } from './bot';
import { considerBetrayal, evaluateRequest, proposeDiplomacy } from './diplomacy';
import { troopGoldValue } from './economy';
import { scoreTargets } from './military';
import { perceive } from './perception';

const SEED = 41;
/** Hard's troop band ceiling. */
const DIFFICULTY_HARD_HIGH = 0.65;

/** Three rows: b | a | c, a in the middle with troops to spare and c weak; `teams` puts a, b and c on teams. */
function middle(
  troops: { a?: number; b?: number; c?: number } = {}, rules?: Partial<MatchRules>, teams?: number[],
): Game {
  const row = 'bbbbaaaacccc';
  return makeTestGame({
    map: [0, 1, 2].map(() => '#'.repeat(row.length)),
    owners: [0, 1, 2].map(() => row),
    nations: [{ troops: troops.a ?? 5000, gold: 0 }, { troops: troops.b ?? 4000 }, { troops: troops.c ?? 100 }],
    rules,
    teams,
  });
}

/** A fresh request `from` → `to`, the only one open. */
function request(g: Game, kind: DiplomacyRequest['kind'], from: number, to: number, extra: { deal?: Deal; target?: number } = {}): DiplomacyRequest {
  g.requests.clear();
  expect(createRequest(g, kind, from, to, extra)).toEqual({ ok: true });
  g.drainEvents();
  return g.requests.get(Math.max(...g.requests.keys()))!;
}

const bot = (g: Game, difficulty: Difficulty = 'hard', personality: Personality = 'builder') => new Bot(g, 1, difficulty, personality, SEED);
const evaluate = (g: Game, b: Bot, req: DiplomacyRequest) => evaluateRequest(g, perceive(g, 1), b, req);
const responses = (cmds: Command[]) => cmds.filter((c) => c.type === 'respond');

describe('answering alliances', () => {
  it('accepts an alliance from a strong neighbour it is not targeting', () => {
    const g = middle();
    const b = bot(g);
    const req = request(g, 'alliance', 2, 1);
    expect(evaluate(g, b, req)).toBe(true);
    expect(responses(b.think())).toEqual([{ type: 'respond', nation: 1, requestId: req.id, accept: true }]);
    // not from its prey, nor from a weak neighbour unless it is a diplomat
    expect(evaluate(g, b, request(g, 'alliance', 3, 1))).toBe(false);
    const weak = middle({ b: 1000 });
    expect(evaluate(weak, bot(weak), request(weak, 'alliance', 2, 1))).toBe(false);
    expect(evaluate(weak, bot(weak, 'hard', 'diplomat'), request(weak, 'alliance', 2, 1))).toBe(true);
  });

  it('refuses an alliance from the runaway leader', () => {
    const row = 'bbbbbbbbbaaacc';
    const g = makeTestGame({
      map: [0, 1, 2].map(() => '#'.repeat(row.length)),
      owners: [0, 1, 2].map(() => row),
      nations: [{ troops: 4000 }, { troops: 8000 }, { troops: 100 }],
    });
    expect(perceive(g, 1).leaderShare).toBeGreaterThan(CONFIG.ai.gangUpShare);
    const b = bot(g, 'hard', 'diplomat');
    const req = request(g, 'alliance', 2, 1);
    expect(evaluate(g, b, req)).toBe(false);
    expect(responses(b.think())).toEqual([{ type: 'respond', nation: 1, requestId: req.id, accept: false }]);
  });

  it('refuses an alliance that would leave it nothing to take by land', () => {
    // a (short of troops, so with no target in mind) borders b, already an ally, and c, who asks; no free land
    const g = middle({ a: 1000, b: 4000, c: 4000 });
    g.relations.set(1, 2, 'allied');
    expect(scoreTargets(g, perceive(g, 1), bot(g, 'hard', 'diplomat'))).toEqual([]);
    expect(evaluate(g, bot(g, 'hard', 'diplomat'), request(g, 'alliance', 3, 1))).toBe(false);
    // with free land still in reach it may
    const free = makeTestGame({
      map: [0, 1, 2].map(() => '#'.repeat(14)), owners: ['bbbbaaaa......', 'bbbbaaaacccc..', 'bbbbaaaacccc..'],
      nations: [{ troops: 1000, gold: 0 }, { troops: 4000 }, { troops: 4000 }],
    });
    free.relations.set(1, 2, 'allied');
    expect(perceive(free, 1).neutralBorder).toBeGreaterThan(0);
    expect(evaluate(free, bot(free, 'hard', 'diplomat'), request(free, 'alliance', 3, 1))).toBe(true);
  });

  it('refuses an alliance from a nation it does not trust', () => {
    const g = middle();
    g.relations.setTrust(1, 2, 0.2);
    expect(evaluate(g, bot(g, 'hard', 'diplomat'), request(g, 'alliance', 2, 1))).toBe(false);
  });
});

describe('answering peace, deals and joint attacks', () => {
  it('accepts peace when losing the war or fighting another', () => {
    const g = middle({ a: 1000, b: 6000 });
    g.relations.set(1, 2, 'war');
    expect(evaluate(g, bot(g), request(g, 'peace', 2, 1))).toBe(true);
    // a strong a at war with a weak b fights on
    const h = middle({ a: 5000, b: 300 });
    h.relations.set(1, 2, 'war');
    expect(evaluate(h, bot(h), request(h, 'peace', 2, 1))).toBe(false);
    // unless it has another war on its hands
    h.relations.set(1, 3, 'war');
    expect(evaluate(h, bot(h), request(h, 'peace', 2, 1))).toBe(true);
  });

  it('accepts peace in a war neither side can fight over land', () => {
    // a and b on islands across the sea: however strong a is, no land attack can reach b
    const g = makeTestGame({
      map: ['..............', '.###......###.', '.###......###.', '.###......###.', '..............'],
      owners: ['..............', '.aaa......bbb.', '.aaa......bbb.', '.aaa......bbb.', '..............'],
      nations: [{ troops: 5000 }, { troops: 300 }],
    });
    g.relations.set(1, 2, 'war');
    expect(evaluate(g, bot(g), request(g, 'peace', 2, 1))).toBe(true);
  });

  it('accepts a profitable deal and rejects a bad one', () => {
    const g = middle();
    const tgv = troopGoldValue(perceive(g, 1));
    const offer = (d: Partial<Deal>): Deal => ({ giveGold: 0, giveTroops: 0, getGold: 0, getTroops: 0, ...d });
    // b pays well for 100 of a's troops
    const good = request(g, 'deal', 2, 1, { deal: offer({ giveGold: Math.ceil(200 * tgv) + 1, getTroops: 100 }) });
    expect(evaluate(g, bot(g), good)).toBe(true);
    expect(evaluate(g, bot(g), request(g, 'deal', 3, 1, { deal: offer({ giveGold: 10, getTroops: 1000 }) }))).toBe(false);
    // a gift is always welcome
    expect(evaluate(g, bot(g), request(g, 'deal', 3, 1, { deal: offer({ giveTroops: 50 }) }))).toBe(true);
    // a price fair in peace is too low in war, when troops are worth more
    const h = middle();
    const fair = request(h, 'deal', 2, 1, { deal: offer({ giveGold: Math.ceil(125 * tgv), getTroops: 100 }) });
    expect(evaluate(h, bot(h), fair)).toBe(true);
    h.relations.set(1, 3, 'war');
    expect(evaluate(h, bot(h), fair)).toBe(false);
    // and nothing it can't pay
    const poor = request(h, 'deal', 2, 1, { deal: offer({ giveGold: 1e9, getTroops: 1e6 }) });
    expect(evaluate(h, bot(h), poor)).toBe(false);
  });

  it('joins a joint attack on a target worth attacking and focuses on it', () => {
    const g = middle();
    g.relations.set(1, 2, 'allied');
    const b = bot(g);
    const req = request(g, 'jointAttack', 2, 1, { target: 3 });
    expect(evaluate(g, b, req)).toBe(true);
    expect(b.memory.focusTarget).toBe(3);
    // not against a nation it doesn't border
    const far = makeTestGame({
      map: ['#'.repeat(16)],
      owners: ['aaaabbbbccccdddd'],
      nations: [{ troops: 5000 }, { troops: 4000 }, { troops: 100 }, { troops: 100 }],
    });
    far.relations.set(1, 2, 'allied');
    const c = bot(far);
    expect(evaluate(far, c, request(far, 'jointAttack', 2, 1, { target: 4 }))).toBe(false);
    expect(c.memory.focusTarget).toBeNull();
  });
});

describe('proposals', () => {
  it('proposes an alliance to avoid a second front', () => {
    const g = middle({ a: 5000, b: 4500 });
    g.relations.set(1, 3, 'war');
    const b = bot(g);
    const cmds = proposeDiplomacy(g, perceive(g, 1), b);
    expect(cmds).toContainEqual({ type: 'proposeAlliance', nation: 1, to: 2 });
    for (const c of cmds) expect(applyCommand(g, c)).toEqual({ ok: true });
    expect(b.memory.lastProposalTick).toBe(g.tick);
    // nothing more until the cooldown has passed
    expect(proposeDiplomacy(g, perceive(g, 1), b)).toEqual([]);
    g.tick += CONFIG.ai.proposalCooldownTicks;
    // and never the same proposal while the first is pending
    expect(proposeDiplomacy(g, perceive(g, 1), b).filter((c) => c.type === 'proposeAlliance')).toEqual([]);
  });

  it('with no alliances, bots propose none', () => {
    const g = middle({ a: 5000, b: 4500 }, { noAlliances: true });
    g.relations.set(1, 3, 'war');
    expect(proposeDiplomacy(g, perceive(g, 1), bot(g)).filter((c) => c.type === 'proposeAlliance')).toEqual([]);
  });

  it('in teams mode bots propose no alliances', () => {
    // b is on another team from a, strong and neutral: the second-front case, but an alliance can't be made
    const g = middle({ a: 5000, b: 4500 }, undefined, [1, 2, 3]);
    g.relations.set(1, 3, 'war');
    expect(g.relations.get(1, 2)).toBe('neutral');
    expect(proposeDiplomacy(g, perceive(g, 1), bot(g)).filter((c) => c.type === 'proposeAlliance')).toEqual([]);
  });

  it('sues for peace when losing', () => {
    const g = middle({ a: 2000, b: 6000 });
    expect(applyCommand(g, { type: 'attack', nation: 2, tile: 4 + 12, ratio: 0.5 })).toEqual({ ok: true });
    const cmds = proposeDiplomacy(g, perceive(g, 1), bot(g));
    expect(cmds).toContainEqual({ type: 'proposePeace', nation: 1, to: 2 });
    for (const c of cmds) expect(applyCommand(g, c)).toEqual({ ok: true });
  });

  it('gangs up on the runaway leader with its allies', () => {
    const row = 'ddddddddddbbbaaaccc';
    const g = makeTestGame({
      map: [0, 1, 2].map(() => '#'.repeat(row.length)),
      owners: [0, 1, 2].map(() => row),
      nations: [{ troops: 4000, gold: 0 }, { troops: 4000 }, { troops: 3000 }, { troops: 9000 }],
    });
    // a borders b and c; b borders the leader d
    g.relations.set(1, 3, 'allied');
    const cmds = proposeDiplomacy(g, perceive(g, 1), bot(g));
    expect(cmds).toContainEqual({ type: 'proposeAlliance', nation: 1, to: 2 });
    expect(cmds).toContainEqual({ type: 'requestJointAttack', nation: 1, to: 3, target: 4 });
    for (const c of cmds) expect(applyCommand(g, c)).toEqual({ ok: true });
    // only profiles that gang up do
    const h = makeTestGame({
      map: [0, 1, 2].map(() => '#'.repeat(row.length)),
      owners: [0, 1, 2].map(() => row),
      nations: [{ troops: 4000, gold: 0 }, { troops: 4000 }, { troops: 3000 }, { troops: 9000 }],
    });
    h.relations.set(1, 3, 'allied');
    expect(proposeDiplomacy(h, perceive(h, 1), bot(h, 'normal'))).toEqual([]);
  });

  it('buys troops with spare gold in a war', () => {
    const g = middle({ a: 2000, b: 6000 });
    g.relations.set(1, 3, 'war');
    g.nations[1].gold = 1e6;
    const cmds = proposeDiplomacy(g, perceive(g, 1), bot(g));
    const deal = cmds.find((c) => c.type === 'proposeDeal') as Extract<Command, { type: 'proposeDeal' }>;
    expect(deal).toMatchObject({ nation: 1, to: 2 });
    expect(deal.deal.giveGold).toBeGreaterThan(0);
    expect(deal.deal.getTroops).toBeGreaterThanOrEqual(1);
    expect(deal.deal.getTroops).toBeLessThanOrEqual(g.nations[2].troops);
    expect(applyCommand(g, deal)).toEqual({ ok: true });
    // the seller, judging by the same rules, takes it
    const seller = new Bot(g, 2, 'hard', 'builder', SEED);
    const req = [...g.requests.values()].find((r) => r.kind === 'deal')!;
    expect(evaluateRequest(g, perceive(g, 2), seller, req)).toBe(true);
  });
});

describe('betrayal', () => {
  /** a allied with a weak b; c strong and expensive to attack. */
  function tempting(): Game {
    const g = middle({ a: 5000, b: 50, c: 4000 });
    g.relations.set(1, 2, 'allied');
    return g;
  }

  it('only betrayal-enabled profiles betray', () => {
    const g = tempting();
    const traitor = bot(g, 'hard', 'aggressive');
    expect(considerBetrayal(g, perceive(g, 1), traitor)).toBe(2);
    const cmds = traitor.think();
    expect(cmds).toContainEqual({ type: 'breakAlliance', nation: 1, with: 2 });
    expect(traitor.memory.betrayTarget).toBe(2);
    // the attack waits for a later decision
    expect(cmds.some((c) => c.type === 'attack' && g.owner[c.tile] === 2)).toBe(false);
    for (const c of cmds) expect(applyCommand(g, c)).toEqual({ ok: true });
    // once its troops are back, it goes for b
    g.nations[1].troops = 5000;
    expect(traitor.think().some((c) => c.type === 'attack' && g.owner[c.tile] === 2)).toBe(true);

    for (const [difficulty, personality] of [['normal', 'aggressive'], ['hard', 'builder'], ['hard', 'diplomat'], ['easy', 'opportunist']] as const) {
      const h = tempting();
      const loyal = bot(h, difficulty, personality);
      expect(considerBetrayal(h, perceive(h, 1), loyal)).toBeNull();
      expect(loyal.think().some((c) => c.type === 'breakAlliance')).toBe(false);
    }
  });

  it('boxed in by allies with troops piling up, any betraying profile breaks with the weakest-defended ally', () => {
    const boxed = (): Game => {
      const g = middle({ a: 5000, b: 3000, c: 300 });
      g.relations.set(1, 2, 'allied');
      g.relations.set(1, 3, 'allied');
      return g;
    };
    const g = boxed();
    expect(perceive(g, 1).troopRatio).toBeGreaterThan(DIFFICULTY_HARD_HIGH);
    // a builder normally never betrays; boxed in, it does, picking weak c over strong b
    expect(considerBetrayal(g, perceive(g, 1), bot(g, 'hard', 'builder'))).toBe(3);
    // not when it can't betray at all, nor with troops to spare elsewhere
    const n = boxed();
    expect(considerBetrayal(n, perceive(n, 1), bot(n, 'normal', 'aggressive'))).toBeNull();
    const low = boxed();
    low.nations[1].troops = 1000;
    expect(considerBetrayal(low, perceive(low, 1), bot(low, 'hard', 'builder'))).toBeNull();
  });

  it('bots never betray a teammate', () => {
    // the tempting case: a weak ally next door, but now a teammate
    const g = middle({ a: 5000, b: 50, c: 4000 }, undefined, [1, 1, 2]);
    expect(g.relations.get(1, 2)).toBe('allied');
    const traitor = bot(g, 'hard', 'aggressive');
    expect(considerBetrayal(g, perceive(g, 1), traitor)).toBeNull();
    expect(traitor.think().some((c) => c.type === 'breakAlliance')).toBe(false);
    // boxed in by teammates with troops piling up: still loyal
    const boxed = middle({ a: 5000, b: 3000, c: 300 }, undefined, [1, 1, 1]);
    expect(perceive(boxed, 1).troopRatio).toBeGreaterThan(DIFFICULTY_HARD_HIGH);
    expect(considerBetrayal(boxed, perceive(boxed, 1), bot(boxed, 'hard', 'builder'))).toBeNull();
  });

  it('keeps an ally that is not worth betraying', () => {
    const g = middle({ a: 5000, b: 3000, c: 100 });
    g.relations.set(1, 2, 'allied');
    expect(considerBetrayal(g, perceive(g, 1), bot(g, 'insane', 'opportunist'))).toBeNull();
  });
});

describe('bots in a match', () => {
  it('never attacks an ally while allied', () => {
    const m = new Match({
      map: generateRandomMap(SEED, 'small'),
      seed: SEED,
      player: null,
      bots: Array.from({ length: 8 }, () => ({ difficulty: 'hard' as const })),
      spawnTicks: 1,
      checkVictory: false,
    });
    const rejected: GameEvent[] = [];
    let requests = 0;
    for (let i = 0; i < 2000; i++) {
      m.step();
      for (const e of m.game.drainEvents()) {
        if (e.type === 'rejected') rejected.push(e);
        if (e.type === 'request') requests++;
      }
    }
    expect(rejected.filter((e) => e.type === 'rejected' && e.reason === 'allied')).toEqual([]);
    expect(rejected).toEqual([]);
    expect(requests).toBeGreaterThan(0);
  }, 60_000);
});
