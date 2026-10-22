import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42), b = new Rng(42);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });

  it('differs across seeds', () => expect(new Rng(1).next()).not.toBe(new Rng(2).next()));

  it('next stays in [0, 1)', () => {
    const r = new Rng(123);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int is inclusive and in range', () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(r.int(3, 5));
    expect([...seen].sort()).toEqual([3, 4, 5]);
  });

  it('int handles a single-value range', () => {
    const r = new Rng(5);
    for (let i = 0; i < 20; i++) expect(r.int(4, 4)).toBe(4);
  });

  it('chance respects its extremes and roughly its probability', () => {
    const r = new Rng(11);
    for (let i = 0; i < 100; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (r.chance(0.25)) hits++;
    expect(hits / 10000).toBeGreaterThan(0.22);
    expect(hits / 10000).toBeLessThan(0.28);
  });

  it('pick returns members and throws on an empty array', () => {
    const r = new Rng(3);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(r.pick(items));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
    expect(() => r.pick([])).toThrow();
  });

  it('fork is deterministic', () => expect(new Rng(9).fork(1).next()).toBe(new Rng(9).fork(1).next()));

  it('fork neither depends on nor advances the parent state', () => {
    const a = new Rng(9), b = new Rng(9);
    a.next(); a.next(); a.next();
    expect(a.fork(1).next()).toBe(b.fork(1).next());
    const c = new Rng(9), d = new Rng(9);
    c.fork(1);
    expect(c.next()).toBe(d.next());
  });

  it('fork differs across salts and from the parent seed', () => {
    const r = new Rng(9);
    expect(r.fork(1).next()).not.toBe(r.fork(2).next());
    expect(r.fork(1).next()).not.toBe(new Rng(9).next());
  });
});
