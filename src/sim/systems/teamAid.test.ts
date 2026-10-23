import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../../shared/rules';
import type { MatchRules } from '../../shared/rules';
import type { Command, GameEvent } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { Match } from '../match';
import { buildUpdate } from '../snapshot';
import { mapFromAscii } from '../testing/asciiMap';
import { makeTestGame } from '../testing/fixtures';
import { askReadyIn } from './teamAid';

/** a and b on team 1, c on team 2, side by side on a row of plains. */
const teamGame = (rules: Partial<MatchRules> = {}): Game => makeTestGame({
  map: ['############'], owners: ['aaaabbbbcccc'],
  nations: [{ gold: 1000, troops: 2000 }, { gold: 500, troops: 3000 }, { gold: 800, troops: 1000 }],
  teams: [1, 1, 2], rules,
});

const ok = (g: Game, cmd: Command): void => expect(applyCommand(g, cmd)).toEqual({ ok: true });

function reject(g: Game, cmd: Command, reason: string): void {
  expect(applyCommand(g, cmd)).toEqual({ ok: false, reason });
  expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: cmd.nation, reason }]);
}

const purse = (g: Game, id: number): [number, number] => [g.nations[id].gold, g.nations[id].troops];
const lastRequest = (g: Game): number => Math.max(...g.requests.keys());
const resolved = (events: GameEvent[]) => events.filter((e) => e.type === 'requestResolved');
const aid = (nation: number, to: number, gold: number, troops: number): Command => ({ type: 'sendAid', nation, to, gold, troops });
const ask = (nation: number, to: number, resource: 'troops' | 'gold' = 'troops'): Command => ({ type: 'askAid', nation, to, resource });
const askAttack = (nation: number, to: number, target: number): Command => ({ type: 'requestJointAttack', nation, to, target });

describe('sendAid', () => {
  it('sendAid moves gold and troops to a teammate at once and emits aidSent', () => {
    const g = teamGame();
    ok(g, aid(1, 2, 300, 500));
    expect([purse(g, 1), purse(g, 2)]).toEqual([[700, 1500], [800, 3500]]);
    expect(g.drainEvents()).toEqual([{ type: 'aidSent', from: 1, to: 2, gold: 300, troops: 500 }]);
    // gold alone, troops alone, everything they have
    ok(g, aid(2, 1, 800, 0));
    ok(g, aid(1, 2, 0, 1500));
    expect([purse(g, 1), purse(g, 2)]).toEqual([[1500, 0], [0, 5000]]);
    expect(g.drainEvents()).toEqual([
      { type: 'aidSent', from: 2, to: 1, gold: 800, troops: 0 },
      { type: 'aidSent', from: 1, to: 2, gold: 0, troops: 1500 },
    ]);
  });

  it('sendAid is refused: not a teammate, bad amount (negative, not finite, both 0), not enough gold or troops', () => {
    const g = teamGame();
    reject(g, aid(1, 3, 100, 0), 'not a teammate');
    reject(g, aid(3, 1, 0, 100), 'not a teammate');
    reject(g, aid(1, 1, 100, 0), 'yourself');
    reject(g, aid(1, 9, 100, 0), 'unknown nation');
    reject(g, aid(1, 2, -1, 100), 'bad amount');
    reject(g, aid(1, 2, 100, -5), 'bad amount');
    reject(g, aid(1, 2, Number.NaN, 100), 'bad amount');
    reject(g, aid(1, 2, 100, Number.POSITIVE_INFINITY), 'bad amount');
    reject(g, aid(1, 2, 0, 0), 'bad amount');
    reject(g, aid(1, 2, 1001, 0), 'not enough gold');
    reject(g, aid(1, 2, 0, 2001), 'not enough troops');
    expect([purse(g, 1), purse(g, 2), purse(g, 3)]).toEqual([[1000, 2000], [500, 3000], [800, 1000]]);
    // a fallen teammate keeps the existing reason
    g.nations[2].alive = false;
    reject(g, aid(1, 2, 100, 0), 'eliminated');
    // free-for-all has no teammates
    const ffa = makeTestGame({ map: ['####'], owners: ['aabb'], nations: [{ gold: 100 }, {}] });
    reject(ffa, aid(1, 2, 50, 0), 'not a teammate');
  });
});

describe('askAid', () => {
  it('askAid opens an aid request; asking the same teammate again within 300 ticks is refused: too soon', () => {
    const g = teamGame();
    ok(g, ask(1, 2, 'troops'));
    const id = lastRequest(g);
    const request = g.requests.get(id);
    expect(request).toEqual({ id, kind: 'aid', from: 1, to: 2, expiresAt: 300, resource: 'troops' });
    expect(g.drainEvents()).toEqual([{ type: 'request', request }]);
    // asking changes nothing by itself
    expect([purse(g, 1), purse(g, 2)]).toEqual([[1000, 2000], [500, 3000]]);
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: false });
    g.drainEvents();
    g.tick = 299;
    reject(g, ask(1, 2, 'gold'), 'too soon');
    // the wait is the asker's own, toward that teammate
    ok(g, ask(2, 1, 'gold'));
    g.tick = 300;
    ok(g, ask(1, 2, 'gold'));
    expect(g.requests.get(lastRequest(g))).toMatchObject({ kind: 'aid', from: 1, to: 2, resource: 'gold' });
    g.drainEvents();
    // an ask still open is refused as today
    g.tick = 600;
    reject(g, ask(1, 2, 'gold'), 'already proposed');
  });

  it('askAid is refused for nations that are not living teammates and for a bad resource', () => {
    const g = teamGame();
    reject(g, ask(1, 3), 'not a teammate');
    reject(g, ask(1, 1), 'yourself');
    reject(g, ask(1, 0), 'unknown nation');
    reject(g, { type: 'askAid', nation: 1, to: 2, resource: 'land' } as unknown as Command, 'bad resource');
    g.nations[2].alive = false;
    reject(g, ask(1, 2), 'eliminated');
    expect(g.requests.size).toBe(0);
    // a refused ask starts no wait
    g.nations[2].alive = true;
    ok(g, ask(1, 2));
  });

  it('joint-attack requests between teammates follow the same 300-tick rule, and work with no alliances', () => {
    const g = teamGame({ noAlliances: true });
    expect(g.tuning.alliances).toBe(false);
    ok(g, askAttack(1, 2, 3));
    const id = lastRequest(g);
    expect(g.requests.get(id)).toMatchObject({ kind: 'jointAttack', from: 1, to: 2, target: 3 });
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: true });
    g.drainEvents();
    g.tick = 299;
    reject(g, askAttack(1, 2, 3), 'too soon');
    // asks of one teammate share one wait, whatever they ask for
    reject(g, ask(1, 2), 'too soon');
    g.tick = 300;
    ok(g, askAttack(1, 2, 3));
    g.drainEvents();
    g.tick = 450;
    reject(g, ask(1, 2), 'too soon');
  });

  it("allies who aren't teammates ask each other to attack with no wait, as today", () => {
    const g = makeTestGame({ map: ['######'], owners: ['aabbcc'], nations: [{}, {}, {}] });
    g.relations.set(1, 2, 'allied');
    ok(g, askAttack(1, 2, 3));
    ok(g, { type: 'respond', nation: 2, requestId: lastRequest(g), accept: false });
    ok(g, askAttack(1, 2, 3));
    expect(g.asks.size).toBe(0);
  });
});

describe('respond with a reason', () => {
  it('respond passes its reason to requestResolved', () => {
    const g = teamGame();
    ok(g, ask(1, 2));
    const id = lastRequest(g);
    g.drainEvents();
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: false, reason: 'busy' });
    expect(g.drainEvents()).toEqual([
      { type: 'requestResolved', requestId: id, kind: 'aid', from: 1, to: 2, accepted: false, reason: 'busy' },
    ]);
    // accepting changes nothing by itself, and an answer without a reason carries none
    g.tick = 300;
    ok(g, ask(1, 2, 'gold'));
    g.drainEvents();
    ok(g, { type: 'respond', nation: 2, requestId: lastRequest(g), accept: true });
    expect([purse(g, 1), purse(g, 2)]).toEqual([[1000, 2000], [500, 3000]]);
    const [event] = resolved(g.drainEvents());
    expect(event).toMatchObject({ kind: 'aid', accepted: true });
    expect(event).not.toHaveProperty('reason');
  });
});

describe('askReadyIn', () => {
  it("askReadyIn counts down for the player's teammates and is 0 for others", () => {
    const m = new Match({
      map: mapFromAscii(['############']), seed: 3, player: { name: 'You' },
      bots: [{ difficulty: 'easy', team: 1 }, { difficulty: 'easy', team: 2 }, { difficulty: 'easy', team: 2 }],
      rules: { ...DEFAULT_RULES, mode: 'teams', teams: 2 },
    });
    const g = m.game;
    g.phase = 'playing';
    const waits = (): number[] => buildUpdate(m).nations.map((n) => n.askReadyIn);
    expect(waits()).toEqual([0, 0, 0, 0]);
    ok(g, ask(1, 2));
    expect(askReadyIn(g, 1, 2)).toBe(300);
    g.tick = 120;
    expect(askReadyIn(g, 1, 2)).toBe(180);
    expect(waits()).toEqual([0, 180, 0, 0]);
    // the bots' own waits aren't the player's
    ok(g, ask(3, 4));
    ok(g, ask(2, 1, 'gold'));
    expect(askReadyIn(g, 3, 4)).toBe(300);
    expect(askReadyIn(g, 1, 3)).toBe(0);
    expect(waits()).toEqual([0, 180, 0, 0]);
    g.tick = 300;
    expect(waits()).toEqual([0, 0, 0, 0]);
    // free-for-all: nobody waits
    const ffa = new Match({ map: mapFromAscii(['####']), seed: 3, player: { name: 'You' }, bots: [{ difficulty: 'easy' }] });
    expect(buildUpdate(ffa).nations.map((n) => n.askReadyIn)).toEqual([0, 0]);
  });
});
