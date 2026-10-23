import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import { makeTestGame } from '../testing/fixtures';
import { canTrade, declareWar, Relations } from './relations';

const threeNations = () => makeTestGame({ map: ['###'], nations: [{}, {}, {}] });

describe('Relations', () => {
  it('starts neutral, without embargoes, at the configured default trust', () => {
    const r = new Relations(4);
    expect(r.get(1, 2)).toBe('neutral');
    expect(r.embargoed(1, 2)).toBe(false);
    expect(r.trust(1, 2)).toBe(CONFIG.diplomacy.defaultTrust);
    expect(r.trust(1, 2)).toBe(0.5);
    expect(r.warsOf(1)).toEqual([]);
  });

  it('set applies to both directions', () => {
    const r = new Relations(4);
    r.set(1, 3, 'allied');
    expect(r.get(1, 3)).toBe('allied');
    expect(r.get(3, 1)).toBe('allied');
    expect(r.get(1, 2)).toBe('neutral');
    r.set(3, 1, 'war');
    expect(r.get(1, 3)).toBe('war');
    r.set(1, 3, 'neutral');
    expect(r.get(3, 1)).toBe('neutral');
  });

  it('keeps pairs independent of each other', () => {
    const r = new Relations(4);
    r.set(1, 2, 'war');
    r.set(2, 3, 'allied');
    expect([r.get(1, 2), r.get(2, 3), r.get(1, 3)]).toEqual(['war', 'allied', 'neutral']);
  });

  it('embargo is one-directional to set but blocks in either direction', () => {
    const r = new Relations(4);
    r.setEmbargo(1, 2, true);
    expect(r.embargoed(1, 2)).toBe(true);
    expect(r.embargoed(2, 1)).toBe(true);
    expect(r.embargoed(1, 3)).toBe(false);
    r.setEmbargo(1, 2, false);
    expect(r.embargoed(1, 2)).toBe(false);
    r.setEmbargo(2, 1, true);
    expect(r.embargoed(1, 2)).toBe(true);
  });

  it('trust is directional', () => {
    const r = new Relations(4);
    r.setTrust(1, 2, 0.9);
    expect(r.trust(1, 2)).toBeCloseTo(0.9, 6);
    expect(r.trust(2, 1)).toBe(0.5);
  });

  it('warsOf lists every nation at war with a, in id order', () => {
    const r = new Relations(5);
    r.set(2, 4, 'war');
    r.set(2, 1, 'war');
    r.set(2, 3, 'allied');
    expect(r.warsOf(2)).toEqual([1, 4]);
    expect(r.warsOf(4)).toEqual([2]);
    expect(r.warsOf(3)).toEqual([]);
  });
});

describe('declareWar', () => {
  it('is symmetric and emits one relation event', () => {
    const g = threeNations();
    declareWar(g, 1, 2);
    expect(g.relations.get(1, 2)).toBe('war');
    expect(g.relations.get(2, 1)).toBe('war');
    expect(g.relations.warsOf(1)).toEqual([2]);
    expect(g.drainEvents()).toEqual([{ type: 'relation', a: 1, b: 2, relation: 'war' }]);
  });

  it('does nothing when the pair is already at war', () => {
    const g = threeNations();
    declareWar(g, 1, 2);
    g.drainEvents();
    declareWar(g, 2, 1);
    expect(g.drainEvents()).toEqual([]);
    expect(g.relations.get(1, 2)).toBe('war');
  });

  it('does nothing for the unowned id or for a nation against itself', () => {
    const g = threeNations();
    declareWar(g, 0, 1);
    declareWar(g, 1, 0);
    declareWar(g, 2, 2);
    expect(g.drainEvents()).toEqual([]);
    expect(g.relations.get(0, 1)).toBe('neutral');
    expect(g.relations.get(2, 2)).toBe('neutral');
  });

  it('throws when the pair is allied and leaves the alliance intact', () => {
    const g = threeNations();
    g.relations.set(1, 3, 'allied');
    expect(() => declareWar(g, 1, 3)).toThrow();
    expect(g.relations.get(1, 3)).toBe('allied');
    expect(g.drainEvents()).toEqual([]);
  });

  it('turns a neutral pair into war without touching other pairs', () => {
    const g = threeNations();
    declareWar(g, 3, 1);
    expect(g.relations.get(1, 3)).toBe('war');
    expect(g.relations.get(1, 2)).toBe('neutral');
    expect(g.relations.get(2, 3)).toBe('neutral');
  });
});

describe('canTrade', () => {
  it('is true for neutral and allied pairs with no embargo', () => {
    const g = threeNations();
    g.relations.set(1, 3, 'allied');
    expect(canTrade(g, 1, 2)).toBe(true);
    expect(canTrade(g, 1, 3)).toBe(true);
  });

  it('is false at war', () => {
    const g = threeNations();
    declareWar(g, 1, 2);
    expect(canTrade(g, 1, 2)).toBe(false);
    expect(canTrade(g, 2, 1)).toBe(false);
  });

  it('embargo in either direction blocks it', () => {
    const g = threeNations();
    g.relations.setEmbargo(1, 2, true);
    expect(canTrade(g, 1, 2)).toBe(false);
    expect(canTrade(g, 2, 1)).toBe(false);
    expect(canTrade(g, 1, 3)).toBe(true);
    g.relations.setEmbargo(1, 2, false);
    g.relations.setEmbargo(2, 1, true);
    expect(canTrade(g, 1, 2)).toBe(false);
    g.relations.setEmbargo(2, 1, false);
    expect(canTrade(g, 1, 2)).toBe(true);
  });
});
