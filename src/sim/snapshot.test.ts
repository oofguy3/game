import { describe, expect, it } from 'vitest';
import { CONFIG } from '../shared/config';
import { DEFAULT_RULES } from '../shared/rules';
import type { MatchRules } from '../shared/rules';
import type { DiplomacyRequest } from '../shared/types';
import type { GameSetup } from './core/game';
import { tileOf } from './map/grid';
import { Match } from './match';
import { buildInit, buildUpdate, lookOptions } from './snapshot';
import { startAttack } from './systems/attacks';
import { mapFromAscii } from './testing/asciiMap';

const setup = (rows: string[], overrides: Partial<GameSetup> = {}): GameSetup => ({
  map: mapFromAscii(rows),
  seed: 5,
  player: { name: 'You' },
  bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }],
  ...overrides,
});
const plains = (w: number, h: number): string[] => Array.from({ length: h }, () => '#'.repeat(w));
const LOOK = { latitude: { top: 72, bottom: -72 }, seed: 1, dryBands: false };

describe('lookOptions', () => {
  it('the world map uses its projection, seed 1 and dry bands; random maps ±72° and their own seed', () => {
    expect(lookOptions({ kind: 'world' })).toEqual({ latitude: { top: 78, bottom: -58 }, seed: 1, dryBands: true });
    expect(lookOptions({ kind: 'random', size: 'small', seed: 99 }))
      .toEqual({ latitude: { top: 72, bottom: -72 }, seed: 99, dryBands: false });
  });
});

describe('buildInit', () => {
  it('describes the map and nations with a copy of the terrain', () => {
    const m = new Match(setup(plains(6, 4)));
    const init = buildInit(m, LOOK);
    expect(init).toMatchObject({ width: 6, height: 4, playerId: 1, spawnEndsAt: CONFIG.spawn.phaseTicks });
    expect(init.nations.map((n) => [n.id, n.isPlayer])).toEqual([[1, true], [2, false], [3, false]]);
    expect(init.nations[0].name).toBe(m.game.nations[1].name);
    expect(init.nations[0].color).toBe(m.game.nations[1].color);
    init.terrain[0] = 0;
    expect(m.game.map.terrain[0]).toBe(1);
  });
});

describe('buildInit rules and teams', () => {
  it("buildInit carries the rules and each nation's team", () => {
    const rules: MatchRules = { ...DEFAULT_RULES, mode: 'teams', teams: 2, richStart: true };
    const bots = Array.from({ length: 3 }, () => ({ difficulty: 'easy' as const }));
    const m = new Match(setup(plains(6, 4), { bots, rules }));
    const init = buildInit(m, LOOK);
    expect(init.rules).toEqual(rules);
    expect(init.nations.map((n) => n.team)).toEqual(m.game.nations.slice(1).map((n) => n.team));
    expect(init.nations.map((n) => n.team).sort()).toEqual([1, 1, 2, 2]);
    expect(init.nations[0].team).toBe(1);
    // free-for-all: the default rules, nobody on a team
    const ffa = buildInit(new Match(setup(plains(6, 4))), LOOK);
    expect(ffa.rules).toEqual(DEFAULT_RULES);
    expect(ffa.nations.map((n) => n.team)).toEqual([0, 0, 0]);
  });
});

describe('buildInit look', () => {
  it('carries the look options it is given', () => {
    const look = { latitude: { top: 10, bottom: -10 }, seed: 3, dryBands: false };
    expect(buildInit(new Match(setup(plains(6, 4))), look).look).toEqual(look);
  });
});

describe('buildUpdate', () => {
  it('fronts lists each running attack between two nations once, sorted, without attacks on empty land', () => {
    // empty land, then nations 1, 2 and 3 side by side, then empty land
    const m = new Match(setup(plains(8, 1)));
    const { game } = m;
    for (const [tile, owner] of [[1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 3]]) game.setOwner(tile, owner);
    for (const n of game.nations) n.troops = 1000;
    expect(startAttack(game, 2, 3, 50).ok).toBe(true);
    expect(startAttack(game, 1, 2, 50).ok).toBe(true);
    expect(startAttack(game, 1, 2, 30).ok).toBe(true);
    expect(startAttack(game, 1, 0, 20).ok).toBe(true);
    expect(buildUpdate(m).fronts).toEqual([[1, 2], [2, 3]]);
  });

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

  it('lists each nation’s living allies, in id order', () => {
    const m = new Match(setup(plains(6, 4), { bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }, { difficulty: 'easy' }] }));
    const { game } = m;
    game.relations.set(2, 3, 'allied');
    game.relations.set(2, 4, 'allied');
    game.nations[4].alive = false;
    const allies = Object.fromEntries(buildUpdate(m).nations.map((n) => [n.id, n.allies]));
    expect(allies).toEqual({ 1: [], 2: [3], 3: [2], 4: [] });
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
