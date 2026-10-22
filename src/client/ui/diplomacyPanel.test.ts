import { describe, expect, it } from 'vitest';
import { makeClientState } from '../testing/fixtures';
import { dealFromForm, jointTargets, relationActions } from './diplomacyPanel';

describe('diplomacy panel', () => {
  it('offers what fits the relation', () => {
    expect(relationActions('neutral', false)).toEqual(['Propose alliance', 'Embargo on', 'Gift']);
    expect(relationActions('war', false)).toEqual(['Propose alliance', 'Propose peace', 'Embargo on', 'Gift']);
    expect(relationActions('allied', true)).toEqual(['Break alliance', 'Embargo off', 'Gift']);
  });

  it('reads the deal form as whole, non-negative amounts', () => {
    expect(dealFromForm({ giveGold: '100.7', giveTroops: '', getGold: '-5', getTroops: 'abc' }))
      .toEqual({ giveGold: 100, giveTroops: 0, getGold: 0, getTroops: 0 });
    expect(dealFromForm({ giveGold: '1', giveTroops: '2', getGold: '3', getTroops: '4' }, true))
      .toEqual({ giveGold: 1, giveTroops: 2, getGold: 0, getTroops: 0 });
  });

  it('lists living nations an ally could be asked to attack', () => {
    const { state } = makeClientState(['#####'], ['abcde']);
    state.nations.get(2)!.relationToPlayer = 'allied';
    state.nations.get(4)!.relationToPlayer = 'allied';
    state.nations.get(5)!.alive = false;
    expect(jointTargets(state, 2)).toEqual([3]);
  });
});
