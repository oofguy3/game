import { describe, expect, it } from 'vitest';
import type { Command } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { canTrade } from './relations';

/** a and b on team 1, c on team 2, side by side on a row of plains with 1000 troops each. */
const teamGame = (): Game => makeTestGame({
  map: ['############'], owners: ['aaaabbbbcccc'],
  nations: [{ troops: 1000 }, { troops: 1000 }, { troops: 1000 }], teams: [1, 1, 2],
});

function reject(g: Game, cmd: Command, reason: string): void {
  expect(applyCommand(g, cmd)).toEqual({ ok: false, reason });
  expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: cmd.nation, reason }]);
}

describe('between teammates', () => {
  it('teammates start allied; the other team is neutral', () => {
    const g = teamGame();
    expect(g.rules.mode).toBe('teams');
    expect(g.nations.slice(1).map((n) => n.team)).toEqual([1, 1, 2]);
    expect(g.relations.get(1, 2)).toBe('allied');
    expect(g.relations.get(1, 3)).toBe('neutral');
    expect(g.relations.get(2, 3)).toBe('neutral');
  });

  it('attacks on a teammate are refused as allied', () => {
    const g = teamGame();
    reject(g, { type: 'attack', nation: 1, tile: tileOf(g.map, 4, 0), ratio: 0.5 }, 'allied');
    reject(g, { type: 'attack', nation: 2, tile: tileOf(g.map, 3, 0), ratio: 0.5 }, 'allied');
    // the other team is fair game
    expect(applyCommand(g, { type: 'attack', nation: 2, tile: tileOf(g.map, 8, 0), ratio: 0.5 })).toEqual({ ok: true });
  });

  it('breaking a teammate alliance is refused: teammate', () => {
    const g = teamGame();
    const trust = g.relations.trust(3, 1);
    reject(g, { type: 'breakAlliance', nation: 1, with: 2 }, 'teammate');
    expect(g.relations.get(1, 2)).toBe('allied');
    expect(g.relations.trust(3, 1)).toBe(trust);
  });

  it('an embargo on a teammate is refused: teammate; lifting one is fine', () => {
    const g = teamGame();
    reject(g, { type: 'embargo', nation: 1, with: 2, on: true }, 'teammate');
    expect(g.relations.embargoed(1, 2)).toBe(false);
    expect(applyCommand(g, { type: 'embargo', nation: 1, with: 2, on: false })).toEqual({ ok: true });
    // an embargo on the other team works as today
    expect(applyCommand(g, { type: 'embargo', nation: 1, with: 3, on: true })).toEqual({ ok: true });
    expect(g.relations.embargoed(1, 3)).toBe(true);
  });

  it('alliances across teams are refused: other team', () => {
    const g = teamGame();
    reject(g, { type: 'proposeAlliance', nation: 1, to: 3 }, 'other team');
    reject(g, { type: 'proposeAlliance', nation: 3, to: 2 }, 'other team');
    expect(g.requests.size).toBe(0);
    // between teammates the existing reason applies
    reject(g, { type: 'proposeAlliance', nation: 2, to: 1 }, 'already allied');
    // peace and deals across teams work as today
    expect(applyCommand(g, { type: 'attack', nation: 2, tile: tileOf(g.map, 8, 0), ratio: 0.1 })).toEqual({ ok: true });
    expect(applyCommand(g, { type: 'proposePeace', nation: 3, to: 2 })).toEqual({ ok: true });
    const deal = { giveGold: 0, giveTroops: 10, getGold: 0, getTroops: 0 };
    expect(applyCommand(g, { type: 'proposeDeal', nation: 1, to: 3, deal })).toEqual({ ok: true });
  });

  it('teammates can trade', () => {
    const g = teamGame();
    expect(canTrade(g, 1, 2)).toBe(true);
  });
});
