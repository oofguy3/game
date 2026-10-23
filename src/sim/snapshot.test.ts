import { describe, expect, it } from 'vitest';
import { CONFIG } from '../shared/config';
import type { DiplomacyRequest } from '../shared/types';
import type { GameSetup } from './core/game';
import { tileOf } from './map/grid';
import { Match } from './match';
import { buildInit, buildUpdate } from './snapshot';
import { mapFromAscii } from './testing/asciiMap';

const setup = (rows: string[], overrides: Partial<GameSetup> = {}): GameSetup => ({
  map: mapFromAscii(rows),
  seed: 5,
  player: { name: 'You' },
  bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }],
  ...overrides,
});
const plains = (w: number, h: number): string[] => Array.from({ length: h }, () => '#'.repeat(w));

describe('buildInit', () => {
  it('describes the map and nations with a copy of the terrain', () => {
    const m = new Match(setup(plains(6, 4)));
    const init = buildInit(m);
    expect(init).toMatchObject({ width: 6, height: 4, playerId: 1, spawnEndsAt: CONFIG.spawn.phaseTicks });
    expect(init.nations.map((n) => [n.id, n.isPlayer])).toEqual([[1, true], [2, false], [3, false]]);
    expect(init.nations[0].name).toBe(m.game.nations[1].name);
    expect(init.nations[0].color).toBe(m.game.nations[1].color);
    init.terrain[0] = 0;
    expect(m.game.map.terrain[0]).toBe(1);
  });
});

describe('buildUpdate', () => {
  it('reports each changed tile once, with its current owner', () => {
    const m = new Match(setup(plains(6, 4)));
    const { game } = m;
    game.setOwner(3, 1);
    game.setOwner(3, 2);
    game.setOwner(7, 1);
    const u = buildUpdate(m);
    expect([...u.changedTiles]).toEqual([3, 7]);
    expect([...u.changedOwners]).toEqual([2, 1]);
    const again = buildUpdate(m);
    expect(again.changedTiles.length).toBe(0);
    expect(again.changedOwners.length).toBe(0);
  });

  it('drains the events', () => {
    const m = new Match(setup(plains(6, 4)));
    m.game.emit({ type: 'phase', phase: 'playing' });
    expect(buildUpdate(m).events).toEqual([{ type: 'phase', phase: 'playing' }]);
    expect(buildUpdate(m).events).toEqual([]);
  });

  it('buildUpdate only includes requests addressed to the player', () => {
    const m = new Match(setup(plains(6, 4)));
    const toPlayer: DiplomacyRequest = { id: 1, kind: 'alliance', from: 2, to: 1, expiresAt: 300 };
    const between: DiplomacyRequest = { id: 2, kind: 'peace', from: 2, to: 3, expiresAt: 300 };
    m.game.requests.set(toPlayer.id, toPlayer);
    m.game.requests.set(between.id, between);
    expect(buildUpdate(m).requests).toEqual([toPlayer]);
  });

  it('reports buildings only when they changed', () => {
    const m = new Match(setup(plains(6, 4)));
    const { game } = m;
    expect(buildUpdate(m).buildings).toEqual([]);
    expect(buildUpdate(m).buildings).toBeNull();
    game.setOwner(0, 1);
    game.buildings.add({ id: game.nextId(), type: 'city', owner: 1, tile: 0, ticksLeft: 5, cooldown: 0 });
    expect(buildUpdate(m).buildings).toEqual([
      expect.objectContaining({ type: 'city', owner: 1, tile: 0, underConstruction: true }),
    ]);
    expect(buildUpdate(m).buildings).toBeNull();
  });

  it('snapshots every nation, relative to the player', () => {
    const m = new Match(setup(plains(6, 4)));
    const { game } = m;
    game.setOwner(0, 2);
    game.relations.set(1, 2, 'war');
    const nations = buildUpdate(m).nations;
    expect(nations.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(nations[1]).toMatchObject({ id: 2, tiles: 1, alive: true, relationToPlayer: 'war', embargoed: false });
    expect(nations[1].maxTroops).toBeGreaterThan(0);
  });

  it('labels sit on an owned tile for C-shaped territory', () => {
    // a C whose centroid falls in the empty middle
    const rows = plains(9, 9);
    const m = new Match(setup(rows));
    const { game } = m;
    for (let y = 1; y <= 7; y++) {
      for (let x = 1; x <= 7; x++) {
        const ring = x === 1 || y === 1 || y === 7;
        if (ring) game.setOwner(tileOf(game.map, x, y), 2);
      }
    }
    const centroid = tileOf(game.map, Math.round(game.nations[2].sumX / game.nations[2].tiles),
      Math.round(game.nations[2].sumY / game.nations[2].tiles));
    expect(game.owner[centroid]).not.toBe(2);
    const label = buildUpdate(m).nations[1].label!;
    expect(label).not.toBeNull();
    expect(game.owner[tileOf(game.map, label.x, label.y)]).toBe(2);
    expect(label.size).toBeCloseTo(0.6 * Math.sqrt(game.nations[2].tiles), 12);
    // nations without land get no label
    expect(buildUpdate(m).nations[2].label).toBeNull();
  });
});
