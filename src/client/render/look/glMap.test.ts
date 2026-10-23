import { describe, expect, it } from 'vitest';
import { frontTable } from './glMap';

describe('frontTable', () => {
  it('marks each attacker→target pair and nothing else', () => {
    const t = frontTable([[1, 2], [5, 3]]);
    expect(t).toHaveLength(64 * 64);
    expect(t[1 * 64 + 2]).toBe(1);
    expect(t[5 * 64 + 3]).toBe(1);
    expect(t[2 * 64 + 1]).toBe(0);
    expect(t.reduce((s, v) => s + v, 0)).toBe(2);
  });

  it('leaves out pairs with an id that does not fit the table', () => {
    expect(frontTable([[64, 1], [1, 70]]).reduce((s, v) => s + v, 0)).toBe(0);
  });
});
