import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import { Terrain } from '../../shared/types';
import type { Game } from '../core/game';
import { makeTestGame } from '../testing/fixtures';
import { startAttack, stepAttacks } from './attacks';
import {
  defenderLossPerTile, defenseMultiplier, density, estimateConquest, tileCaptureCost,
} from './combat';

const { terrainCost, neutralCost, baseCost, densityFactor, defenderLossFactor } = CONFIG.combat;

/**
 * Advances only the attacks (no economy, so troop counts follow the combat rules alone) until none is left or
 * `maxTicks` pass, and returns the number of ticks taken.
 */
function runAttacks(g: Game, maxTicks = 2000): number {
  let ticks = 0;
  while (g.attacks.length > 0 && ticks < maxTicks) {
    stepAttacks(g);
    ticks++;
  }
  return ticks;
}

const within = (actual: number, expected: number, share: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(share * Math.abs(expected));

describe('density', () => {
  it('is troops per owned tile', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aaa.'], nations: [{ troops: 300 }] });
    expect(density(g.nations[1])).toBe(100);
  });

  it('counts a nation with no tiles as holding one', () => {
    const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{}, { troops: 50 }] });
    expect(density(g.nations[2])).toBe(50);
  });
});

describe('defenseMultiplier', () => {
  it('is 1 everywhere until buildings exist', () => {
    const g = makeTestGame({ map: ['#^M'], owners: ['ab.'], nations: [{ troops: 10 }, { troops: 10 }] });
    for (let t = 0; t < 3; t++) expect(defenseMultiplier(g, t)).toBe(1);
  });
});

describe('tileCaptureCost', () => {
  it('neutral cost scales with terrain', () => {
    const g = makeTestGame({ map: ['#^M'], nations: [{}] });
    expect(tileCaptureCost(g, 1, 0)).toBe(terrainCost[Terrain.Plains] * neutralCost);
    expect(tileCaptureCost(g, 1, 1) / tileCaptureCost(g, 1, 0)).toBeCloseTo(1.5, 10);
    expect(tileCaptureCost(g, 1, 2) / tileCaptureCost(g, 1, 0)).toBeCloseTo(2.5, 10);
  });

  it('owned tile cost grows with defender density', () => {
    const g = makeTestGame({ map: ['####M'], owners: ['abbbb'], nations: [{}, { troops: 400 }] });
    // b holds 4 tiles with 400 troops: density 100
    expect(tileCaptureCost(g, 1, 1)).toBeCloseTo(baseCost + 100 * densityFactor, 10);
    expect(tileCaptureCost(g, 1, 4)).toBeCloseTo(2.5 * (baseCost + 100 * densityFactor), 10);
    g.nations[2].troops = 800;
    expect(tileCaptureCost(g, 1, 1)).toBeCloseTo(baseCost + 200 * densityFactor, 10);
    g.nations[2].troops = 0;
    expect(tileCaptureCost(g, 1, 1)).toBeCloseTo(baseCost, 10);
  });
});

describe('defenderLossPerTile', () => {
  it('is the owner density times the loss factor, and 0 on unowned land', () => {
    const g = makeTestGame({ map: ['####'], owners: ['abb.'], nations: [{ troops: 10 }, { troops: 300 }] });
    expect(defenderLossPerTile(g, 1)).toBeCloseTo(150 * defenderLossFactor, 10);
    expect(defenderLossPerTile(g, 0)).toBeCloseTo(10 * defenderLossFactor, 10);
    expect(defenderLossPerTile(g, 3)).toBe(0);
  });
});

describe('estimateConquest', () => {
  /**
   * a holds the left three columns, b the rest. Each row cycles plains, hills and mountains with a different phase,
   * so every column (b's first column, the frontier, included) holds one tile of each terrain.
   */
  function frontGame(width: number, bTroops: number, aTroops = 5000): Game {
    const cycle = ['#^M', '^M#', 'M#^'];
    const map = cycle.map((c) => c.repeat(Math.ceil(width / 3)).slice(0, width));
    const owners = map.map(() => 'aaa' + 'b'.repeat(width - 3));
    return makeTestGame({ map, owners, nations: [{ troops: aTroops }, { troops: bTroops }] });
  }

  it('is within 20% of a real run against a nation', () => {
    const g = frontGame(30, 81 * 20); // b: 81 tiles, density 20
    const sent = 1000;
    const est = estimateConquest(g, 1, 2, sent);
    const [aBefore, bBefore, bTilesBefore] = [g.nations[1].troops, g.nations[2].troops, g.nations[2].tiles];
    expect(startAttack(g, 1, 2, sent).ok).toBe(true);
    runAttacks(g);
    const tiles = bTilesBefore - g.nations[2].tiles;
    const attackerLoss = aBefore - g.nations[1].troops;
    const defenderLoss = bBefore - g.nations[2].troops;
    expect(tiles).toBeGreaterThan(10);
    within(est.tiles, tiles, 0.2);
    within(est.attackerLoss, attackerLoss, 0.2);
    within(est.defenderLoss, defenderLoss, 0.2);
  });

  it('is within 20% of a real run into neutral land', () => {
    const g = makeTestGame({
      map: ['#^M#^M#^M#^M#^M#^M#^M#^M', '^M#^M#^M#^M#^M#^M#^M#^M#', 'M#^M#^M#^M#^M#^M#^M#^M#^'],
      owners: ['aaa.....................', 'aaa.....................', 'aaa.....................'],
      nations: [{ troops: 1000 }],
    });
    const est = estimateConquest(g, 1, 0, 100);
    expect(startAttack(g, 1, 0, 100).ok).toBe(true);
    runAttacks(g);
    const tiles = g.nations[1].tiles - 9;
    expect(tiles).toBeGreaterThan(10);
    within(est.tiles, tiles, 0.2);
    within(est.attackerLoss, 1000 - g.nations[1].troops, 0.2);
    expect(est.defenderLoss).toBe(0);
  });

  it('uses the average frontier cost and derives both losses from the tile count', () => {
    const g = makeTestGame({ map: ['####', '#M##'], owners: ['abbb', 'abbb'], nations: [{}, { troops: 600 }] });
    // b: 6 tiles, density 100; frontier = one plains and one mountain tile
    const perTile = baseCost + 100 * densityFactor;
    const c = (perTile * terrainCost[Terrain.Plains] + perTile * terrainCost[Terrain.Mountains]) / 2;
    const est = estimateConquest(g, 1, 2, 3.5 * c);
    expect(est.tiles).toBe(3);
    expect(est.attackerLoss).toBeCloseTo(3 * c, 10);
    expect(est.defenderLoss).toBeCloseTo(3 * 100 * defenderLossFactor, 10);
  });

  it('caps the tiles at the target nation size', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aabb'], nations: [{}, { troops: 10 }] });
    const est = estimateConquest(g, 1, 2, 1e9);
    expect(est.tiles).toBe(2);
    expect(est.defenderLoss).toBeCloseTo(10, 10);
  });

  it('caps neutral expansion at the unowned land of the attacker landmass', () => {
    // a's island has 4 unowned tiles; the other island's 6 are out of reach by land
    const g = makeTestGame({ map: ['#####.######'], owners: ['a...........'], nations: [{}] });
    expect(estimateConquest(g, 1, 0, 1e9).tiles).toBe(4);
    expect(estimateConquest(g, 1, 0, 1e9).attackerLoss).toBeCloseTo(4 * neutralCost, 10);
    expect(estimateConquest(g, 1, 0, 5).tiles).toBe(2);
  });

  it('is zero when the target is not adjacent or nothing is sent', () => {
    const g = makeTestGame({ map: ['##.##'], owners: ['a..bb'], nations: [{ troops: 100 }, { troops: 100 }] });
    expect(estimateConquest(g, 1, 2, 1000)).toEqual({ tiles: 0, attackerLoss: 0, defenderLoss: 0 });
    expect(estimateConquest(g, 1, 0, 0)).toEqual({ tiles: 0, attackerLoss: 0, defenderLoss: 0 });
  });

  it('is pure: changes no game state and draws nothing from game.rng', () => {
    const make = () => frontGame(30, 1620);
    const g = make();
    const twin = make();
    const owners = g.owner.slice();
    const troops = g.nations.map((n) => n.troops);
    estimateConquest(g, 1, 2, 1000);
    estimateConquest(g, 2, 1, 1000);
    estimateConquest(g, 1, 0, 1000);
    expect(g.owner).toEqual(owners);
    expect(g.nations.map((n) => n.troops)).toEqual(troops);
    expect(g.attacks).toEqual([]);
    expect(g.drainEvents()).toEqual([]);
    expect(g.rng.next()).toBe(twin.rng.next());
  });
});
