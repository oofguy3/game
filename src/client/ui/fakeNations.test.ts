import { describe, expect, it } from 'vitest';
import { growNations } from './fakeNations';

/** 60×40: an oval of land in water. */
const W = 60;
const H = 40;
const terrain = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) terrain[y * W + x] = ((x - 30) / 26) ** 2 + ((y - 20) / 17) ** 2 < 1 ? 1 : 0;
}
const land = terrain.reduce((n, t) => n + (t ? 1 : 0), 0);

describe('growNations', () => {
  it('grows the given number of nations over about the given share of land, never on water', () => {
    const owners = growNations(W, H, terrain, 6, 0.35, 3);
    const ids = new Set<number>();
    let owned = 0;
    for (let t = 0; t < owners.length; t++) {
      if (owners[t] === 0) continue;
      expect(terrain[t]).toBe(1);
      ids.add(owners[t]);
      owned++;
    }
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(owned / land).toBeGreaterThanOrEqual(0.33);
    expect(owned / land).toBeLessThanOrEqual(0.37);
  });

  it("each nation's land is connected", () => {
    const owners = growNations(W, H, terrain, 6, 0.35, 3);
    for (let id = 1; id <= 6; id++) {
      const mine: number[] = [];
      for (let t = 0; t < owners.length; t++) if (owners[t] === id) mine.push(t);
      const seen = new Set([mine[0]]);
      const stack = [mine[0]];
      while (stack.length > 0) {
        const t = stack.pop()!;
        const x = t % W;
        for (const m of [x > 0 ? t - 1 : -1, x < W - 1 ? t + 1 : -1, t - W, t + W]) {
          if (m >= 0 && m < owners.length && owners[m] === id && !seen.has(m)) {
            seen.add(m);
            stack.push(m);
          }
        }
      }
      expect(seen.size).toBe(mine.length);
    }
  });

  it('the same seed gives the same nations', () => {
    expect(growNations(W, H, terrain, 6, 0.35, 9)).toEqual(growNations(W, H, terrain, 6, 0.35, 9));
    expect(growNations(W, H, terrain, 6, 0.35, 9)).not.toEqual(growNations(W, H, terrain, 6, 0.35, 10));
  });
});
