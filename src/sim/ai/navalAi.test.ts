import { describe, expect, it } from 'vitest';
import type { BuildingType, Command, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { spawnUnit } from '../systems/units';
import { makeTestGame } from '../testing/fixtures';
import { Bot } from './bot';
import { chooseInvasion, manageWarships } from './naval';
import { perceive } from './perception';

const SEED = 31;

/** a's island (left, fully owned) and a free island (right), across open sea. */
function islands(): Game {
  return makeTestGame({
    map: ['..............', '.###......###.', '.###......###.', '.###......###.', '..............'],
    owners: ['..............', '.aaa..........', '.aaa..........', '.aaa..........', '..............'],
    nations: [{ troops: 4000, gold: 0 }],
  });
}

function place(g: Game, owner: NationId, type: BuildingType, tile: TileIndex): number {
  const id = g.nextId();
  g.buildings.add({ id, type, owner, tile, ticksLeft: 0, cooldown: 0 });
  g.nations[owner].buildingCounts[type]++;
  return id;
}

describe('chooseInvasion', () => {
  it('uses boats when its continent is full', () => {
    const g = islands();
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    let boat: Command | undefined;
    for (let i = 0; i < 5 && !boat; i++) boat = bot.think().find((c) => c.type === 'boat');
    expect(boat).toMatchObject({ type: 'boat', nation: 1 });
    const target = (boat as Extract<Command, { type: 'boat' }>).tile;
    expect(g.map.coastal[target]).toBe(1);
    expect(g.map.landmass[target]).toBe(g.map.landmass[tileOf(g.map, 11, 2)]);
    expect(applyCommand(g, boat!)).toEqual({ ok: true });
  });

  it('does not use boats when cheap land is adjacent', () => {
    const g = makeTestGame({
      map: ['..............', '.###......###.', '.###......###.', '.###......###.', '..............'],
      owners: ['..............', '.aa.......', '.aa.......', '.aa.......', '..............'].map((r) => r.padEnd(14, '.')),
      nations: [{ troops: 4000 }],
    });
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    for (let i = 0; i < 5; i++) expect(bot.think().some((c) => c.type === 'boat')).toBe(false);
    expect(chooseInvasion(g, perceive(g, 1), bot)).toBeNull();
  });

  it('re-checks a remembered target before sending a boat to it', () => {
    const g = islands();
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    const first = chooseInvasion(g, perceive(g, 1), bot) as Extract<Command, { type: 'boat' }>;
    expect(first).toMatchObject({ type: 'boat' });
    // a takes the far island by other means before its next decision
    for (let y = 1; y <= 3; y++) for (let x = 10; x <= 12; x++) g.setOwner(tileOf(g.map, x, y), 1);
    g.tick += 1;
    expect(chooseInvasion(g, perceive(g, 1), bot)).toBeNull();
  });

  it('waits below the troop band', () => {
    const g = islands();
    g.nations[1].troops = 100;
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    expect(chooseInvasion(g, perceive(g, 1), bot)).toBeNull();
  });

  it('prefers the weaker of two overseas nations', () => {
    const g = makeTestGame({
      map: ['..............', '.###......###.', '.###..........', '.###......###.', '..............'],
      owners: ['..............', '.aaa......bbb.', '.aaa..........', '.aaa......ccc.', '..............'],
      nations: [{ troops: 4000 }, { troops: 900 }, { troops: 30 }],
    });
    const bot = new Bot(g, 1, 'insane', 'aggressive', SEED);
    const cmd = chooseInvasion(g, perceive(g, 1), bot) as Extract<Command, { type: 'boat' }>;
    expect(g.owner[cmd.tile]).toBe(3);
  });
});

describe('manageWarships', () => {
  it('builds a warship after being invaded by sea', () => {
    const g = makeTestGame({
      map: ['..............', '.###......###.', '.###......###.', '.###......###.', '..............'],
      owners: ['..............', '.aaa......bbb.', '.aaa......bbb.', '.aaa......bbb.', '..............'],
      nations: [{ troops: 4000, gold: 100_000 }, { troops: 4000 }],
    });
    const base = place(g, 1, 'navalBase', tileOf(g.map, 3, 2));
    const bot = new Bot(g, 1, 'hard', 'builder', SEED);
    expect(manageWarships(g, perceive(g, 1), bot)).toEqual([]);
    // b's boat is on its way to a's beach
    const beach = tileOf(g.map, 3, 1);
    spawnUnit(g, { type: 'troopBoat', owner: 2, x: 8, y: 1, troops: 500, path: [tileOf(g.map, 4, 1)], targetTile: beach });
    const cmds = manageWarships(g, perceive(g, 1), bot);
    expect(cmds).toContainEqual({ type: 'buildUnit', nation: 1, unit: 'warship', buildingId: base });
    expect(bot.memory.lastNavalThreatTick).toBe(g.tick);
    for (const c of cmds) expect(applyCommand(g, c)).toEqual({ ok: true });
    // and the threat makes a naval base worth building for a bot without one (see economy)
  });

  it('sends an idle warship to meet an enemy boat heading for its coast', () => {
    const g = makeTestGame({
      map: ['..............', '.###......###.', '.###......###.', '.###......###.', '..............'],
      owners: ['..............', '.aaa......bbb.', '.aaa......bbb.', '.aaa......bbb.', '..............'],
      nations: [{ troops: 4000, gold: 0 }, { troops: 4000 }],
    });
    const ship = spawnUnit(g, { type: 'warship', owner: 1, x: 6, y: 4, hp: 10, patrol: tileOf(g.map, 6, 4), mission: 'patrol' });
    const boat = spawnUnit(g, { type: 'troopBoat', owner: 2, x: 9, y: 0, troops: 500, path: [tileOf(g.map, 4, 0)], targetTile: tileOf(g.map, 3, 1) });
    const bot = new Bot(g, 1, 'hard', 'builder', SEED);
    const cmds = manageWarships(g, perceive(g, 1), bot);
    expect(cmds).toEqual([{ type: 'moveUnit', nation: 1, unitId: ship.id, tile: tileOf(g.map, Math.round(boat.x), Math.round(boat.y)) }]);
    expect(applyCommand(g, cmds[0])).toEqual({ ok: true });
  });
});

describe('economy under naval threat', () => {
  it('values a naval base once invaded by sea', async () => {
    const { rankBuilds } = await import('./economy');
    const g = makeTestGame({
      map: ['..............', '.###......###.', '.###......###.', '.###......###.', '..............'],
      owners: ['..............', '.aaa......bbb.', '.aaa......bbb.', '.aaa......bbb.', '..............'],
      nations: [{ troops: 4000, gold: 100_000 }, { troops: 4000 }],
    });
    const bot = new Bot(g, 1, 'hard', 'builder', SEED);
    expect(rankBuilds(g, perceive(g, 1), bot).find((r) => r.type === 'navalBase')).toBeUndefined();
    bot.memory.lastNavalThreatTick = g.tick;
    const ranked = rankBuilds(g, perceive(g, 1), bot);
    expect(ranked[0].type).toBe('navalBase');
  });
});
