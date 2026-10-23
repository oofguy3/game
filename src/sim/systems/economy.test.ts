import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { Game } from '../core/game';
import { makeTestGame } from '../testing/fixtures';
import { goldIncome, maxTroops, stepEconomy, troopGrowth } from './economy';

const { baseMax, perTile, baseGrowth, growthRate, overMaxDecay } = CONFIG.troops;

/** One nation (id 1) holding `tiles` plains tiles of a 10-wide strip, with `troops` troops. */
const oneNation = (tiles: number, troops = 0): Game =>
  makeTestGame({ map: ['##########'], owners: ['a'.repeat(tiles) + '.'.repeat(10 - tiles)], nations: [{ troops }] });

describe('maxTroops', () => {
  it('is baseMax plus perTile for each tile', () => {
    for (const tiles of [1, 7]) {
      const g = oneNation(tiles);
      expect(maxTroops(g, g.nations[1])).toBe(baseMax + tiles * perTile);
    }
  });
});

describe('troopGrowth', () => {
  it('growth peaks near half of max', () => {
    const g = oneNation(5);
    const n = g.nations[1];
    const max = maxTroops(g, n);
    const growthAt = (share: number): number => {
      n.troops = share * max;
      return troopGrowth(g, n);
    };
    expect(growthAt(0.5)).toBeGreaterThan(growthAt(0.1));
    expect(growthAt(0.5)).toBeGreaterThan(growthAt(0.95));
    expect(growthAt(0.5)).toBeGreaterThan(growthAt(0.4));
    expect(growthAt(0.5)).toBeGreaterThan(growthAt(0.6));
    // logistic: baseGrowth + growthRate × troops × (1 − troops / max)
    expect(growthAt(0.5)).toBeCloseTo(baseGrowth + growthRate * max * 0.25, 10);
    expect(growthAt(0)).toBe(baseGrowth);
    expect(growthAt(1)).toBeCloseTo(baseGrowth, 10);
  });

  it('troops above max decay toward max', () => {
    const g = oneNation(5);
    const n = g.nations[1];
    const max = maxTroops(g, n);
    n.troops = max + 1000;
    expect(troopGrowth(g, n)).toBeCloseTo(-overMaxDecay * 1000, 10);
    let previous = n.troops;
    for (let i = 0; i < 50; i++) {
      stepEconomy(g);
      expect(n.troops).toBeLessThan(previous);
      expect(n.troops).toBeGreaterThan(max);
      previous = n.troops;
    }
    // the excess shrinks by overMaxDecay a tick
    expect(n.troops - max).toBeCloseTo(1000 * (1 - overMaxDecay) ** 50, 6);
  });

  it('is never negative at or below max', () => {
    const g = oneNation(5);
    const n = g.nations[1];
    const max = maxTroops(g, n);
    for (const troops of [0, 1, max / 3, max - 1, max]) {
      n.troops = troops;
      expect(troopGrowth(g, n)).toBeGreaterThan(0);
    }
  });
});

describe('goldIncome', () => {
  it('gold income grows with land', () => {
    const small = oneNation(2);
    const large = oneNation(9);
    const smallIncome = goldIncome(small, small.nations[1]);
    const largeIncome = goldIncome(large, large.nations[1]);
    expect(largeIncome).toBeGreaterThan(smallIncome);
    expect(smallIncome).toBeCloseTo(CONFIG.gold.base + 2 * CONFIG.gold.perTile, 10);
    expect(largeIncome).toBeCloseTo(CONFIG.gold.base + 9 * CONFIG.gold.perTile, 10);
  });
});

describe('stepEconomy', () => {
  it('applies growth and income, and counts the gold earned', () => {
    const g = oneNation(4, 1000);
    const n = g.nations[1];
    n.gold = 100;
    n.stats.goldEarned = 30;
    const growth = troopGrowth(g, n);
    const income = goldIncome(g, n);
    stepEconomy(g);
    expect(n.troops).toBeCloseTo(1000 + growth, 10);
    expect(n.gold).toBeCloseTo(100 + income, 10);
    expect(n.stats.goldEarned).toBeCloseTo(30 + income, 10);
  });

  it('decays every living nation\'s trade income average', () => {
    const g = makeTestGame({ map: ['###'], owners: ['ab.'], nations: [{ tradeIncome: 10 }, { tradeIncome: 4 }] });
    stepEconomy(g);
    expect(g.nations[1].tradeIncome).toBeCloseTo(10 * CONFIG.gold.tradeIncomeDecay, 10);
    expect(g.nations[2].tradeIncome).toBeCloseTo(4 * CONFIG.gold.tradeIncomeDecay, 10);
    stepEconomy(g);
    expect(g.nations[1].tradeIncome).toBeCloseTo(10 * CONFIG.gold.tradeIncomeDecay ** 2, 10);
  });

  it('leaves dead and unspawned nations alone', () => {
    // a holds land; b is dead; c is alive but never spawned
    const g = makeTestGame({
      map: ['###'], owners: ['a..'],
      nations: [{ troops: 10 }, { alive: false, troops: 10, gold: 10, tradeIncome: 5 }, { troops: 10, gold: 10 }],
    });
    stepEconomy(g);
    expect(g.nations[1].troops).toBeGreaterThan(10);
    expect(g.nations[2]).toMatchObject({ troops: 10, gold: 10, tradeIncome: 5, stats: { goldEarned: 0 } });
    expect(g.nations[3]).toMatchObject({ troops: 10, gold: 10, stats: { goldEarned: 0 } });
    // the unowned placeholder never earns anything
    expect(g.nations[0]).toMatchObject({ troops: 0, gold: 0 });
  });

  it('runs only in the playing phase', () => {
    for (const phase of ['spawn', 'ended'] as const) {
      const g = oneNation(4, 1000);
      g.nations[1].tradeIncome = 10;
      g.phase = phase;
      stepEconomy(g);
      expect(g.nations[1]).toMatchObject({ troops: 1000, gold: 0, tradeIncome: 10, stats: { goldEarned: 0 } });
    }
  });

  it('Game.step runs it once per playing tick', () => {
    const g = oneNation(4, 1000);
    const n = g.nations[1];
    const growth = troopGrowth(g, n);
    g.step();
    expect(n.troops).toBeCloseTo(1000 + growth, 10);
    expect(n.gold).toBeCloseTo(goldIncome(g, n), 10);
    g.step();
    expect(n.gold).toBeCloseTo(2 * goldIncome(g, n), 10);
  });

  it('Game.step applies commands, then the economy, then the attacks', () => {
    // b starts with no troops on two tiles
    const g = makeTestGame({ map: ['###'], owners: ['abb'], nations: [{ troops: 1000 }, { troops: 0 }] });
    g.queue({ type: 'attack', nation: 1, tile: 1, ratio: 1 });
    g.step();
    // the command emptied a's pool before the economy grew it from zero
    expect(g.nations[1].troops).toBeCloseTo(baseGrowth, 10);
    // b had grown to baseGrowth troops (density baseGrowth / 2) by the time a took its first tile
    const { baseCost, densityFactor } = CONFIG.combat;
    expect(g.owner[1]).toBe(1);
    expect(g.attacks[0].troops).toBeCloseTo(1000 - (baseCost + (baseGrowth / 2) * densityFactor), 10);
  });
});
