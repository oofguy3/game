import { describe, expect, it } from 'vitest';
import { MaxHeap } from './heap';
import { Rng } from './rng';

describe('MaxHeap', () => {
  it('pops highest priority first', () => {
    const h = new MaxHeap();
    h.push(1, 5); h.push(2, 9); h.push(3, 1);
    expect([h.pop(), h.pop(), h.pop(), h.pop()]).toEqual([2, 1, 3, undefined]);
  });

  it('handles 10k random pushes in order', () => {
    const rng = new Rng(2024);
    const h = new MaxHeap();
    const priorities: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const p = rng.next() * 1000;
      priorities.push(p);
      h.push(i, p);
    }
    expect(h.size).toBe(10000);
    let prev = Infinity;
    const popped = new Set<number>();
    for (let i = 0; i < 10000; i++) {
      const top = h.peekPriority();
      const v = h.pop() as number;
      popped.add(v);
      expect(priorities[v]).toBe(top);
      expect(priorities[v]).toBeLessThanOrEqual(prev);
      prev = priorities[v];
    }
    expect(h.size).toBe(0);
    expect(h.pop()).toBeUndefined();
    expect(popped.size).toBe(10000);
  });

  it('peekPriority reports the top priority and -Infinity when empty', () => {
    const h = new MaxHeap();
    expect(h.peekPriority()).toBe(-Infinity);
    h.push(7, 3); h.push(8, 12); h.push(9, 5);
    expect(h.peekPriority()).toBe(12);
    h.pop();
    expect(h.peekPriority()).toBe(5);
  });

  it('keeps duplicate priorities and tracks size', () => {
    const h = new MaxHeap();
    h.push(1, 4); h.push(2, 4); h.push(3, 4);
    expect(h.size).toBe(3);
    expect([h.pop(), h.pop(), h.pop()].sort()).toEqual([1, 2, 3]);
    expect(h.size).toBe(0);
  });

  it('clear empties the heap and it stays usable', () => {
    const h = new MaxHeap();
    h.push(1, 1); h.push(2, 2);
    h.clear();
    expect(h.size).toBe(0);
    expect(h.pop()).toBeUndefined();
    expect(h.peekPriority()).toBe(-Infinity);
    h.push(5, 10);
    expect(h.pop()).toBe(5);
  });
});
