import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { BuildingType, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { startAttack, stepAttacks } from '../systems/attacks';
import { stepBuildings } from '../systems/buildings';
import { defenseMultiplier } from '../systems/combat';
import { goldIncome, maxTroops, troopGrowth } from '../systems/economy';
import { declareWar } from '../systems/relations';
import { perceive } from './perception';

/** `height` rows of `width` characters, each one `cell(x, y)`. */
const rows = (width: number, height: number, cell: (x: number, y: number) => string): string[] =>
  Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => cell(x, y)).join(''));

const build = (g: Game, nation: NationId, building: BuildingType, tile: TileIndex): void => {
  expect(applyCommand(g, { type: 'build', nation, building, tile })).toEqual({ ok: true });
};

describe('perceive', () => {
  it('perceives neighbours, shared border and neutral border', () => {
    const g = makeTestGame({ map: ['######'], owners: ['aabb..'], nations: [{ troops: 100 }, { troops: 300 }] });
    expect(perceive(g, 1).neighbors).toEqual([expect.objectContaining({ id: 2, sharedBorder: 1, troops: 300 })]);
    expect(perceive(g, 2).neutralBorder).toBe(1);

    expect(perceive(g, 1).neighbors).toEqual([{
      id: 2, sharedBorder: 1, troops: 300, tiles: 2, density: 150, relation: 'neutral', defense: 1, otherWars: 0,
      attackingMe: 0, buildings: 0,
    }]);
    expect(perceive(g, 1).neutralBorder).toBe(0);
    expect(perceive(g, 2).neighbors).toEqual([expect.objectContaining({ id: 1, sharedBorder: 1, troops: 100 })]);
  });

  it('counts each touching tile once and leaves water out of the neutral border', () => {
    // a holds an L around b's single tile; a touches two neutral land tiles and one water tile
    const g = makeTestGame({
      map: ['####.', '####.', '.....'],
      owners: ['aaa..', 'ab...', '.....'],
      nations: [{ troops: 100 }, { troops: 50 }],
    });
    const a = perceive(g, 1);
    expect(a.neighbors).toEqual([expect.objectContaining({ id: 2, sharedBorder: 1 })]);
    expect(a.neutralBorder).toBe(2);
    expect(a.coastalTiles).toBe(1);

    const b = perceive(g, 2);
    expect(b.neighbors).toEqual([expect.objectContaining({ id: 1, sharedBorder: 2 })]);
    expect(b.neutralBorder).toBe(1);
    expect(b.coastalTiles).toBe(1);
  });

  it('lists neighbours in id order and skips the dead', () => {
    // a meets d (4) on its left before b (2) on its right
    const g = makeTestGame({
      map: ['#####'],
      owners: ['cdabb'],
      nations: [{}, {}, {}, {}],
    });
    expect(perceive(g, 3).neighbors.map((n) => n.id)).toEqual([4]);
    expect(perceive(g, 1).neighbors.map((n) => n.id)).toEqual([2, 4]);
    g.nations[4].alive = false;
    expect(perceive(g, 1).neighbors.map((n) => n.id)).toEqual([2]);
  });

  it('reports incoming attack troops and wars', () => {
    // a (1) sits between b (2) and c (3); b and c also border each other on the bottom row
    const g = makeTestGame({
      map: ['#######', '#######'],
      owners: ['bbaaacc', 'bbbbccc'],
      nations: [{ troops: 1000 }, { troops: 500 }, { troops: 300 }],
    });
    expect(perceive(g, 1)).toMatchObject({ incoming: 0, wars: [], threat: 0 });

    expect(startAttack(g, 2, 1, 50)).toEqual({ ok: true });
    expect(startAttack(g, 3, 2, 40)).toEqual({ ok: true });
    expect(startAttack(g, 3, 1, 70)).toEqual({ ok: true });
    expect(startAttack(g, 2, 1, 30)).toEqual({ ok: true });

    const p = perceive(g, 1);
    expect(p.incoming).toBe(150);
    expect(p.wars).toEqual([2, 3]);
    expect(p.threat).toBe(420);
    expect(p.neighbors).toEqual([
      expect.objectContaining({ id: 2, troops: 420, relation: 'war', otherWars: 1, attackingMe: 80 }),
      expect.objectContaining({ id: 3, troops: 190, relation: 'war', otherWars: 1, attackingMe: 70 }),
    ]);

    const b = perceive(g, 2);
    expect(b.incoming).toBe(40);
    expect(b.wars).toEqual([1, 3]);
    expect(b.threat).toBe(1000);
    expect(b.neighbors).toEqual([
      expect.objectContaining({ id: 1, relation: 'war', otherWars: 1, attackingMe: 0 }),
      expect.objectContaining({ id: 3, relation: 'war', otherWars: 1, attackingMe: 40 }),
    ]);
  });

  it('forgets wars with eliminated nations', () => {
    // a (1) is at war with c (3) on its left and with d (4) beyond b (2)
    const g = makeTestGame({
      map: ['########'],
      owners: ['cabbbbbd'],
      nations: [{ troops: 1000 }, { troops: 500 }, { troops: 1 }, { troops: 500 }],
    });
    declareWar(g, 1, 4);
    expect(startAttack(g, 1, 3, 500)).toEqual({ ok: true });
    expect(perceive(g, 1).wars).toEqual([3, 4]);
    expect(perceive(g, 2).neighbors[0]).toMatchObject({ id: 1, otherWars: 2 });

    for (let i = 0; i < 100 && g.nations[3].alive; i++) stepAttacks(g);
    expect(g.nations[3].alive).toBe(false);
    // the war itself stands; perception just no longer counts the dead
    expect(g.relations.get(1, 3)).toBe('war');
    expect(perceive(g, 1).wars).toEqual([4]);
    expect(perceive(g, 2).neighbors[0]).toMatchObject({ id: 1, otherWars: 1 });
  });

  it('threat counts only neighbours at war with me', () => {
    const g = makeTestGame({
      map: ['#######'],
      owners: ['bbaaacc'],
      nations: [{ troops: 100 }, { troops: 500 }, { troops: 300 }],
    });
    expect(startAttack(g, 1, 3, 10)).toEqual({ ok: true });
    g.relations.set(1, 2, 'allied');
    const p = perceive(g, 1);
    expect(p.wars).toEqual([3]);
    expect(p.threat).toBe(300);
    expect(p.neighbors.map((n) => n.relation)).toEqual(['allied', 'war']);
  });

  it('finds the leader and its share', () => {
    // 10 land tiles: a 1, b 4, c 4, one unowned
    const g = makeTestGame({ map: ['##########..'], owners: ['abbbbcccc...'], nations: [{}, {}, {}] });
    expect(perceive(g, 1)).toMatchObject({ leader: 2, leaderShare: 0.4, myShare: 0.1 });
    expect(perceive(g, 3)).toMatchObject({ leader: 2, leaderShare: 0.4, myShare: 0.4 });

    g.setOwner(9, 3);
    expect(perceive(g, 1)).toMatchObject({ leader: 3, leaderShare: 0.5, myShare: 0.1 });

    g.nations[3].alive = false;
    expect(perceive(g, 1)).toMatchObject({ leader: 2, leaderShare: 0.4 });
  });

  it('reads its own economy', () => {
    const g = makeTestGame({
      map: ['######'],
      owners: ['aaaa..'],
      nations: [{ troops: 2000, gold: 300, tradeIncome: 1.5 }],
    });
    const n = g.nations[1];
    expect(perceive(g, 1)).toMatchObject({
      me: 1,
      troops: 2000,
      maxTroops: maxTroops(g, n),
      troopRatio: 2000 / maxTroops(g, n),
      gold: 300,
      income: goldIncome(g, n),
      growth: troopGrowth(g, n),
      tradeIncome: 1.5,
      tiles: 4,
      density: 500,
      neutralBorder: 1,
      neighbors: [],
    });
  });

  it('samples front defenses over the first shared-border tiles and counts every building', () => {
    const { defenseSamples } = CONFIG.ai;
    const { radius, buildTicks } = CONFIG.buildings.defensePost;
    // a holds columns 0-4 and b columns 5-11 of a tall strip, so their border is the column pair 4|5
    const height = defenseSamples + radius + 10;
    const g = makeTestGame({
      map: rows(12, height, () => '#'),
      owners: rows(12, height, (x) => (x < 5 ? 'a' : 'b')),
      nations: [{ troops: 100 }, { troops: 100, gold: 1e9 }],
    });
    // a post near the top covers the first rows of b's front but not the rest
    build(g, 2, 'defensePost', tileOf(g.map, 6, 0));
    expect(perceive(g, 1).neighbors[0]).toMatchObject({ sharedBorder: height, defense: 1, buildings: 1 });

    for (let i = 0; i < buildTicks; i++) stepBuildings(g);
    const front = Array.from({ length: height }, (_, y) => tileOf(g.map, 5, y));
    const average = (tiles: TileIndex[]): number =>
      tiles.reduce((sum, t) => sum + defenseMultiplier(g, t), 0) / tiles.length;
    const sampled = average(front.slice(0, defenseSamples));
    expect(sampled).toBeGreaterThan(1);
    expect(sampled).not.toBeCloseTo(average(front), 3);
    expect(perceive(g, 1).neighbors[0].defense).toBeCloseTo(sampled, 10);
  });
});
