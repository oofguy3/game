import { describe, expect, it } from 'vitest';
import type { DiplomacyRequest } from '../../shared/types';
import { makeClientState } from '../testing/fixtures';
import { describeRequest, isStale, openRequests, secondsLeft } from './requests';

const names = new Map([[1, 'You'], [2, 'Varlonia'], [3, 'Kestria']]);
const req = (over: Partial<DiplomacyRequest>): DiplomacyRequest => ({ id: 9, kind: 'alliance', from: 2, to: 1, expiresAt: 300, ...over });

describe('request popups', () => {
  it('describes each kind from the player’s side', () => {
    expect(describeRequest(req({}), names)).toBe('Varlonia offers an alliance');
    expect(describeRequest(req({ kind: 'peace' }), names)).toBe('Varlonia asks for peace');
    expect(describeRequest(req({ kind: 'jointAttack', target: 3 }), names)).toBe('Varlonia asks you to attack Kestria');
    expect(describeRequest(req({ kind: 'deal', deal: { giveGold: 1500, giveTroops: 200, getGold: 0, getTroops: 300 } }), names))
      .toBe('Varlonia offers 1.5k gold and 200 troops for 300 troops');
    expect(describeRequest(req({ kind: 'deal', deal: { giveGold: 500, giveTroops: 0, getGold: 0, getTroops: 0 } }), names))
      .toBe('Varlonia sends you 500 gold');
  });

  it('counts down whole seconds to expiry', () => {
    expect(secondsLeft(req({ expiresAt: 300 }), 0)).toBe(30);
    expect(secondsLeft(req({ expiresAt: 300 }), 291)).toBe(1);
    expect(secondsLeft(req({ expiresAt: 300 }), 400)).toBe(0);
  });
});

describe('isStale', () => {
  it('drops offers the relation already settled', () => {
    const { state } = makeClientState(['###'], ['abc']);
    state.nations.get(2)!.relationToPlayer = 'allied';
    expect(isStale(state, req({ kind: 'alliance', from: 2 }))).toBe(true);
    expect(isStale(state, req({ kind: 'alliance', from: 3 }))).toBe(false);
    expect(isStale(state, req({ kind: 'peace', from: 3 }))).toBe(true);
    state.nations.get(3)!.relationToPlayer = 'war';
    expect(isStale(state, req({ kind: 'peace', from: 3 }))).toBe(false);
    expect(isStale(state, req({ kind: 'deal', from: 3 }))).toBe(false);
  });
});

describe('openRequests', () => {
  it('lists the live requests, and none once the game is over', () => {
    const { state } = makeClientState(['###'], ['abc']);
    state.nations.get(2)!.relationToPlayer = 'allied';
    state.requests = [req({ id: 1, kind: 'alliance', from: 2 }), req({ id: 2, kind: 'deal', from: 3 })];
    expect(openRequests(state).map((r) => r.id)).toEqual([2]);
    state.phase = 'ended';
    expect(openRequests(state)).toEqual([]);
  });
});
