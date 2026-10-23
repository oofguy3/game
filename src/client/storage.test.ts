import { describe, expect, it } from 'vitest';
import { safeStorage } from './storage';

describe('safeStorage', () => {
  it('passes reads and writes through to a working store', () => {
    const map = new Map<string, string>();
    const store = safeStorage(() => ({ getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }) as unknown as Storage);
    expect(store.getItem('a')).toBeNull();
    store.setItem('a', '1');
    expect(store.getItem('a')).toBe('1');
  });

  it('swallows errors from a broken store, or from reaching it at all', () => {
    const broken = safeStorage(() => ({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } }) as unknown as Storage);
    expect(broken.getItem('a')).toBeNull();
    expect(() => broken.setItem('a', '1')).not.toThrow();
    const unreachable = safeStorage(() => { throw new Error('SecurityError'); });
    expect(unreachable.getItem('a')).toBeNull();
    expect(() => unreachable.setItem('a', '1')).not.toThrow();
    expect(safeStorage(() => undefined).getItem('a')).toBeNull();
  });
});
