import { describe, expect, it } from 'vitest';
import type { Command, Deal, GameEvent } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { makeTestGame } from '../testing/fixtures';
import { proposeDeal, requestJointAttack } from './diplomacy';

function three(): Game {
  return makeTestGame({
    map: ['############'],
    owners: ['aaaabbbbcccc'],
    nations: [{ gold: 1000, troops: 500 }, { gold: 200, troops: 2000 }, { gold: 0, troops: 100 }],
  });
}

const deal = (d: Partial<Deal>): Deal => ({ giveGold: 0, giveTroops: 0, getGold: 0, getTroops: 0, ...d });
const ok = (g: Game, cmd: Command): void => expect(applyCommand(g, cmd)).toEqual({ ok: true });

function reject(g: Game, cmd: Command, reason: string): void {
  expect(applyCommand(g, cmd)).toEqual({ ok: false, reason });
  expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: cmd.nation, reason }]);
}

const lastRequest = (g: Game): number => Math.max(...g.requests.keys());
const resolved = (events: GameEvent[]) => events.filter((e) => e.type === 'requestResolved');
const purse = (g: Game, id: number): [number, number] => [g.nations[id].gold, g.nations[id].troops];

describe('deals', () => {
  it('accepted deal swaps gold and troops', () => {
    const g = three();
    const offer = deal({ giveGold: 300, getTroops: 400 });
    ok(g, { type: 'proposeDeal', nation: 1, to: 2, deal: offer });
    const id = lastRequest(g);
    expect(g.requests.get(id)).toMatchObject({ kind: 'deal', from: 1, to: 2, deal: offer });
    // nothing changes hands until b says yes
    expect([purse(g, 1), purse(g, 2)]).toEqual([[1000, 500], [200, 2000]]);
    g.drainEvents();
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: true });
    expect([purse(g, 1), purse(g, 2)]).toEqual([[700, 900], [500, 1600]]);
    expect(resolved(g.drainEvents())).toEqual([{ type: 'requestResolved', requestId: id, kind: 'deal', from: 1, to: 2, accepted: true }]);
  });

  it('a declined deal moves nothing', () => {
    const g = three();
    ok(g, { type: 'proposeDeal', nation: 1, to: 2, deal: deal({ giveGold: 300, getGold: 100 }) });
    ok(g, { type: 'respond', nation: 2, requestId: lastRequest(g), accept: false });
    expect([purse(g, 1), purse(g, 2)]).toEqual([[1000, 500], [200, 2000]]);
  });

  it('deal fails if a side can no longer pay', () => {
    const g = three();
    // the proposer must afford its side up front
    reject(g, { type: 'proposeDeal', nation: 1, to: 2, deal: deal({ giveGold: 1001 }) }, 'not enough gold');
    reject(g, { type: 'proposeDeal', nation: 1, to: 2, deal: deal({ giveTroops: 501 }) }, 'not enough troops');
    // the proposer spent its gold before the answer came
    ok(g, { type: 'proposeDeal', nation: 1, to: 2, deal: deal({ giveGold: 300, getTroops: 400 }) });
    let id = lastRequest(g);
    g.nations[1].gold = 100;
    g.drainEvents();
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: true });
    expect([purse(g, 1), purse(g, 2)]).toEqual([[100, 500], [200, 2000]]);
    expect(resolved(g.drainEvents())).toEqual([{ type: 'requestResolved', requestId: id, kind: 'deal', from: 1, to: 2, accepted: false }]);
    // the addressee can't pay its side
    ok(g, { type: 'proposeDeal', nation: 1, to: 2, deal: deal({ giveGold: 50, getGold: 250 }) });
    id = lastRequest(g);
    g.drainEvents();
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: true });
    expect([purse(g, 1), purse(g, 2)]).toEqual([[100, 500], [200, 2000]]);
    expect(resolved(g.drainEvents())).toEqual([expect.objectContaining({ requestId: id, accepted: false })]);
  });

  it('gift transfers one way', () => {
    const g = three();
    ok(g, { type: 'proposeDeal', nation: 1, to: 3, deal: deal({ giveGold: 500, giveTroops: 100 }) });
    ok(g, { type: 'respond', nation: 3, requestId: lastRequest(g), accept: true });
    expect([purse(g, 1), purse(g, 3)]).toEqual([[500, 400], [500, 200]]);
    g.drainEvents();
    for (const bad of [deal({}), deal({ giveGold: -5 }), deal({ getTroops: Number.NaN }), deal({ giveGold: Infinity })]) {
      reject(g, { type: 'proposeDeal', nation: 1, to: 3, deal: bad }, 'bad deal');
    }
    expect(proposeDeal(g, 1, 1, deal({ giveGold: 1 }))).toEqual({ ok: false, reason: 'yourself' });
  });
});

describe('joint attacks', () => {
  it('joint attack requires an alliance and a non-allied target', () => {
    const g = makeTestGame({
      map: ['################'],
      owners: ['aaaabbbbccccdddd'],
      nations: [{}, {}, {}, {}],
    });
    reject(g, { type: 'requestJointAttack', nation: 1, to: 2, target: 3 }, 'not allied');
    g.relations.set(1, 2, 'allied');
    reject(g, { type: 'requestJointAttack', nation: 1, to: 2, target: 2 }, 'bad target');
    reject(g, { type: 'requestJointAttack', nation: 1, to: 2, target: 1 }, 'bad target');
    reject(g, { type: 'requestJointAttack', nation: 1, to: 2, target: 0 }, 'bad target');
    g.relations.set(2, 4, 'allied');
    reject(g, { type: 'requestJointAttack', nation: 1, to: 2, target: 4 }, 'target is an ally');
    g.nations[3].alive = false;
    reject(g, { type: 'requestJointAttack', nation: 1, to: 2, target: 3 }, 'eliminated');
    g.nations[3].alive = true;
    ok(g, { type: 'requestJointAttack', nation: 1, to: 2, target: 3 });
    const id = lastRequest(g);
    expect(g.requests.get(id)).toMatchObject({ kind: 'jointAttack', from: 1, to: 2, target: 3 });
    g.drainEvents();
    // accepting is a promise, not an action: relations stay as they were
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: true });
    expect([g.relations.get(2, 3), g.relations.get(1, 3)]).toEqual(['neutral', 'neutral']);
    expect(resolved(g.drainEvents())).toEqual([{ type: 'requestResolved', requestId: id, kind: 'jointAttack', from: 1, to: 2, accepted: true }]);
    expect(requestJointAttack(g, 1, 9, 3)).toEqual({ ok: false, reason: 'unknown nation' });
  });
});
