import { describe, expect, it } from 'vitest';
import { nationColor } from '../../shared/colors';
import { CONFIG } from '../../shared/config';
import { BUILDING_TYPES } from '../../shared/types';
import type { Command, GameEvent, NationId, Phase, TileIndex } from '../../shared/types';
import { tileOf } from '../map/grid';
import { mapFromAscii } from '../testing/asciiMap';
import { makeTestGame } from '../testing/fixtures';
import { Rng } from '../util/rng';
import { applyCommand } from './commands';
import type { CommandResult } from './commands';
import { Game } from './game';
import { nationNames } from './names';

const rejections = (events: GameEvent[]) => events.filter((e) => e.type === 'rejected');

/** One well-formed command of every type except `spawn` and `debugGrant`, all on behalf of nation 1. */
const GAMEPLAY_COMMANDS: Command[] = [
  { type: 'attack', nation: 1, tile: 1, ratio: 0.5 },
  { type: 'boat', nation: 1, tile: 1, ratio: 0.5 },
  { type: 'build', nation: 1, building: 'city', tile: 0 },
  { type: 'buildUnit', nation: 1, unit: 'warship', buildingId: 1 },
  { type: 'moveUnit', nation: 1, unitId: 1, tile: 1 },
  { type: 'bomb', nation: 1, tile: 1 },
  { type: 'paradrop', nation: 1, tile: 1, ratio: 0.5 },
  { type: 'proposeAlliance', nation: 1, to: 1 },
  { type: 'breakAlliance', nation: 1, with: 1 },
  { type: 'proposePeace', nation: 1, to: 1 },
  { type: 'proposeDeal', nation: 1, to: 1, deal: { giveGold: 0, giveTroops: 0, getGold: 0, getTroops: 0 } },
  { type: 'requestJointAttack', nation: 1, to: 1, target: 1 },
  { type: 'respond', nation: 1, requestId: 1, accept: true },
  { type: 'embargo', nation: 1, with: 1, on: true },
];
const SPAWN_COMMAND: Command = { type: 'spawn', nation: 1, tile: 1 };
const GRANT_COMMAND: Command = { type: 'debugGrant', nation: 1, gold: 5 };

const isWrongPhase = (r: CommandResult): boolean => !r.ok && r.reason === 'wrong phase';

describe('Game construction', () => {
  it('player is nation 1, bots follow', () => {
    const g = new Game({
      map: mapFromAscii(['####']), seed: 1, player: { name: 'You' },
      bots: [{ difficulty: 'easy' }, { difficulty: 'hard' }],
    });
    expect(g.playerId).toBe(1);
    expect(g.nations).toHaveLength(4);
    expect(g.nations[3].difficulty).toBe('hard');
    expect(g.nations[1]).toMatchObject({ id: 1, name: 'You', isPlayer: true, difficulty: null, color: 0x3b82f6 });
    expect(g.nations[2]).toMatchObject({ id: 2, isPlayer: false, difficulty: 'easy' });
  });

  it('without a player the bots start at id 1 and playerId is 0', () => {
    const g = new Game({ map: mapFromAscii(['####']), seed: 1, player: null, bots: [{ difficulty: 'normal' }, { difficulty: 'insane' }] });
    expect(g.playerId).toBe(0);
    expect(g.nations).toHaveLength(3);
    expect(g.nations.map((n) => n.id)).toEqual([0, 1, 2]);
    expect(g.nations[1].isPlayer).toBe(false);
    expect(g.nations[2].difficulty).toBe('insane');
  });

  it('nation 0 is a dead placeholder for unowned land', () => {
    const g = new Game({ map: mapFromAscii(['##']), seed: 1, player: { name: 'You' }, bots: [] });
    expect(g.nations[0]).toMatchObject({ id: 0, alive: false, spawned: false, tiles: 0 });
    expect(g.alive().map((n) => n.id)).toEqual([1]);
  });

  it('new nations start alive but unspawned with zeroed state', () => {
    const g = new Game({ map: mapFromAscii(['##']), seed: 1, player: null, bots: [{ difficulty: 'easy', personality: 'builder' }] });
    const n = g.nations[1];
    expect(n).toMatchObject({
      alive: true, spawned: false, spawnTile: -1, troops: 0, gold: 0, tiles: 0, tradeIncome: 0, sumX: 0, sumY: 0,
      personality: 'builder', stats: { peakTiles: 0, tilesCaptured: 0, buildingsBuilt: 0, goldEarned: 0 },
    });
    expect(n.border.size).toBe(0);
    expect(Object.keys(n.buildingCounts).sort()).toEqual([...BUILDING_TYPES].sort());
    expect(Object.values(n.buildingCounts).every((c) => c === 0)).toBe(true);
  });

  it('bots without a personality get null', () => {
    const g = new Game({ map: mapFromAscii(['##']), seed: 1, player: null, bots: [{ difficulty: 'easy' }] });
    expect(g.nations[1].personality).toBeNull();
  });

  it('starts in the spawn phase with the configured length', () => {
    const g = new Game({ map: mapFromAscii(['##']), seed: 1, player: null, bots: [] });
    expect(g.phase).toBe('spawn');
    expect(g.tick).toBe(0);
    expect(g.result).toBeNull();
    expect(g.spawnEndsAt).toBe(CONFIG.spawn.phaseTicks);
    expect(g.spawnSpacing).toBe(CONFIG.spawn.minDistance);
    expect(g.debug).toBe(false);
    expect(g.checkVictory).toBe(true);
    expect(g.owner).toBeInstanceOf(Uint16Array);
    expect(g.owner).toHaveLength(2);
  });

  it('honours spawnTicks, debug and checkVictory', () => {
    const g = new Game({ map: mapFromAscii(['##']), seed: 1, player: null, bots: [], spawnTicks: 7, debug: true, checkVictory: false });
    expect(g.spawnEndsAt).toBe(7);
    expect(g.debug).toBe(true);
    expect(g.checkVictory).toBe(false);
  });

  it('builds a water nav for the map', () => {
    const g = new Game({ map: mapFromAscii(['#.', '..']), seed: 1, player: null, bots: [] });
    expect(g.nav.cellSize).toBe(CONFIG.map.navCellSize);
  });

  it('gives every nation a unique name and its own color', () => {
    const g = new Game({
      map: mapFromAscii(['##']), seed: 3, player: { name: 'You' },
      bots: Array.from({ length: 12 }, () => ({ difficulty: 'normal' as const })),
    });
    const real = g.nations.slice(1);
    expect(new Set(real.map((n) => n.name)).size).toBe(real.length);
    expect(new Set(real.map((n) => n.color)).size).toBe(real.length);
    for (const n of real.slice(1)) expect(n.color).toBe(nationColor(n.id, false));
  });

  it('names depend only on the seed', () => {
    const make = (seed: number) => new Game({ map: mapFromAscii(['##']), seed, player: null, bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }, { difficulty: 'easy' }] });
    const names = (g: Game) => g.nations.map((n) => n.name);
    expect(names(make(5))).toEqual(names(make(5)));
    expect(names(make(5))).not.toEqual(names(make(6)));
  });

  it('sizes the relations table for every nation', () => {
    const g = new Game({ map: mapFromAscii(['##']), seed: 1, player: { name: 'You' }, bots: [{ difficulty: 'easy' }] });
    expect(g.relations.get(1, 2)).toBe('neutral');
    g.relations.set(2, 1, 'war');
    expect(g.relations.warsOf(1)).toEqual([2]);
  });

  it('nextId hands out increasing unique ids', () => {
    const g = new Game({ map: mapFromAscii(['##']), seed: 1, player: null, bots: [] });
    const ids = [g.nextId(), g.nextId(), g.nextId()];
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBeLessThan(ids[1]);
    expect(ids[1]).toBeLessThan(ids[2]);
  });
});

describe('setOwner', () => {
  it('maintains counts, borders and changed tiles', () => {
    const g = makeTestGame({ map: ['#####'], owners: ['aab..'], nations: [{}, {}] });
    expect(g.nations[1].tiles).toBe(2);
    expect([...g.nations[1].border]).toEqual([1]);
    g.setOwner(2, 1);
    expect(g.nations[2].tiles).toBe(0);
    expect([...g.nations[1].border]).toEqual([2]);
    expect(g.drainChangedTiles()).toContain(2);
  });

  it('updates the border of both nations when a tile changes hands', () => {
    const g = makeTestGame({ map: ['#####'], owners: ['aabbb'], nations: [{}, {}] });
    expect([...g.nations[1].border]).toEqual([1]);
    expect([...g.nations[2].border]).toEqual([2]);
    g.setOwner(2, 1);
    expect([...g.nations[1].border]).toEqual([2]);
    expect([...g.nations[2].border]).toEqual([3]);
    expect([g.nations[1].tiles, g.nations[2].tiles]).toEqual([3, 2]);
  });

  it('counts water and unowned land, but not the map edge, as outside', () => {
    const solid = makeTestGame({ map: ['###', '###', '###'], owners: ['aaa', 'aaa', 'aaa'], nations: [{}] });
    expect(solid.nations[1].border.size).toBe(0);
    const coast = makeTestGame({ map: ['##.'], owners: ['aa.'], nations: [{}] });
    expect([...coast.nations[1].border]).toEqual([1]);
  });

  it('recomputes vertical and horizontal neighbours', () => {
    const g = makeTestGame({ map: ['###', '###', '###'], owners: ['aaa', 'aaa', 'aaa'], nations: [{}, {}] });
    const centre = tileOf(g.map, 1, 1);
    g.setOwner(centre, 2);
    expect([...g.nations[1].border].sort((x, y) => x - y)).toEqual([1, 3, 5, 7]);
    expect([...g.nations[2].border]).toEqual([centre]);
    g.setOwner(centre, 1);
    expect(g.nations[1].border.size).toBe(0);
    expect(g.nations[2].border.size).toBe(0);
    expect(g.nations[2].tiles).toBe(0);
  });

  it('releasing a tile to unowned removes it from the border and exposes its neighbours', () => {
    const g = makeTestGame({ map: ['###'], owners: ['aaa'], nations: [{}] });
    g.setOwner(1, 0);
    expect(g.nations[1].tiles).toBe(2);
    expect([...g.nations[1].border].sort()).toEqual([0, 2]);
    expect(g.owner[1]).toBe(0);
  });

  it('tracks coordinate sums for centroids', () => {
    const g = makeTestGame({ map: ['###', '###'], owners: ['a..', '.aa'], nations: [{}] });
    expect([g.nations[1].sumX, g.nations[1].sumY]).toEqual([0 + 1 + 2, 0 + 1 + 1]);
    g.setOwner(tileOf(g.map, 2, 1), 0);
    expect([g.nations[1].sumX, g.nations[1].sumY]).toEqual([0 + 1, 0 + 1]);
  });

  it('peakTiles keeps the maximum after losses', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aaa.'], nations: [{}] });
    expect(g.nations[1].stats.peakTiles).toBe(3);
    g.setOwner(0, 0);
    g.setOwner(1, 0);
    expect(g.nations[1].tiles).toBe(1);
    expect(g.nations[1].stats.peakTiles).toBe(3);
    g.setOwner(3, 1);
    expect(g.nations[1].stats.peakTiles).toBe(3);
  });

  it('is a no-op when the owner does not change', () => {
    const g = makeTestGame({ map: ['###'], owners: ['a..'], nations: [{}] });
    let calls = 0;
    g.onOwnerChange.push(() => { calls++; });
    g.setOwner(0, 1);
    g.setOwner(2, 0);
    expect(calls).toBe(0);
    expect(g.drainChangedTiles()).toEqual([]);
    expect(g.nations[1].tiles).toBe(1);
  });

  it('records every changed tile once drained', () => {
    const g = makeTestGame({ map: ['###'], nations: [{}] });
    g.setOwner(0, 1);
    g.setOwner(2, 1);
    expect(g.drainChangedTiles()).toEqual([0, 2]);
    expect(g.drainChangedTiles()).toEqual([]);
  });

  it('calls onOwnerChange hooks after the state is updated', () => {
    const g = makeTestGame({ map: ['###'], owners: ['aa.'], nations: [{}, {}] });
    const seen: { tile: TileIndex; from: NationId; to: NationId; ownerNow: number; tilesNow: number }[] = [];
    g.onOwnerChange.push((tile, from, to) => seen.push({ tile, from, to, ownerNow: g.owner[tile], tilesNow: g.nations[to].tiles }));
    g.onOwnerChange.push((tile) => seen.push({ tile, from: -1, to: -1, ownerNow: -1, tilesNow: -1 }));
    g.setOwner(1, 2);
    expect(seen).toEqual([
      { tile: 1, from: 1, to: 2, ownerNow: 2, tilesNow: 1 },
      { tile: 1, from: -1, to: -1, ownerNow: -1, tilesNow: -1 },
    ]);
  });
});

describe('applyCommand', () => {
  it('rejects commands from unknown or dead nations with one event', () => {
    const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{}, { alive: false }], debug: true });
    expect(applyCommand(g, { type: 'debugGrant', nation: 9, gold: 1 })).toEqual({ ok: false, reason: 'unknown nation' });
    expect(applyCommand(g, { type: 'debugGrant', nation: 2, gold: 1 })).toEqual({ ok: false, reason: 'eliminated' });
    expect(g.drainEvents().filter((e) => e.type === 'rejected')).toHaveLength(2);
  });

  it('emits the rejected event naming the nation and reason', () => {
    const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{}, { alive: false }], debug: true });
    applyCommand(g, { type: 'debugGrant', nation: 9, gold: 1 });
    applyCommand(g, { type: 'debugGrant', nation: 2, gold: 1 });
    expect(g.drainEvents()).toEqual([
      { type: 'rejected', nation: 9, reason: 'unknown nation' },
      { type: 'rejected', nation: 2, reason: 'eliminated' },
    ]);
    expect(g.nations[2].gold).toBe(0);
  });

  it('treats the unowned id, negative ids and fractional ids as unknown', () => {
    const g = makeTestGame({ map: ['##'], nations: [{}], debug: true });
    for (const nation of [0, -1, 1.5, 2]) {
      expect(applyCommand(g, { type: 'debugGrant', nation, gold: 1 })).toEqual({ ok: false, reason: 'unknown nation' });
    }
    expect(rejections(g.drainEvents())).toHaveLength(4);
  });

  it('debugGrant adds gold and troops in debug games', () => {
    const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{ gold: 10, troops: 20 }], debug: true });
    expect(applyCommand(g, { type: 'debugGrant', nation: 1, gold: 5, troops: 7 })).toEqual({ ok: true });
    expect([g.nations[1].gold, g.nations[1].troops]).toEqual([15, 27]);
    expect(applyCommand(g, { type: 'debugGrant', nation: 1, gold: 1 })).toEqual({ ok: true });
    expect([g.nations[1].gold, g.nations[1].troops]).toEqual([16, 27]);
    expect(g.drainEvents()).toEqual([]);
  });

  it('debugGrant only works in debug games', () => {
    const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{ gold: 10 }] });
    const reason = 'debug commands are disabled';
    expect(applyCommand(g, { type: 'debugGrant', nation: 1, gold: 5 })).toEqual({ ok: false, reason });
    expect(g.nations[1].gold).toBe(10);
    expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: 1, reason }]);
  });

  it('rejects every other command type as not implemented, with one event each', () => {
    const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{}], debug: true });
    const unimplemented = GAMEPLAY_COMMANDS.filter((cmd) => cmd.type !== 'attack' && cmd.type !== 'build');
    for (const cmd of unimplemented) {
      expect(applyCommand(g, cmd)).toEqual({ ok: false, reason: 'not implemented' });
    }
    const events = g.drainEvents();
    expect(events).toHaveLength(unimplemented.length);
    expect(events.every((e) => e.type === 'rejected' && e.nation === 1 && e.reason === 'not implemented')).toBe(true);
  });
});

describe('applyCommand phase gating', () => {
  const gameIn = (phase: Phase, debug = true) => {
    const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{}, { alive: false }], debug });
    g.phase = phase;
    return g;
  };

  it('in the spawn phase only spawn and debugGrant are accepted', () => {
    const g = gameIn('spawn');
    for (const cmd of GAMEPLAY_COMMANDS) expect(applyCommand(g, cmd)).toEqual({ ok: false, reason: 'wrong phase' });
    expect(g.drainEvents()).toEqual(GAMEPLAY_COMMANDS.map(() => ({ type: 'rejected', nation: 1, reason: 'wrong phase' })));
    expect(applyCommand(g, GRANT_COMMAND)).toEqual({ ok: true });
    expect(g.nations[1].gold).toBe(5);
    expect(applyCommand(g, SPAWN_COMMAND)).toEqual({ ok: true });
    expect(g.nations[1].gold).toBe(CONFIG.spawn.startGold);
  });

  it('in the playing phase spawn is rejected and everything else reaches its handler', () => {
    const g = gameIn('playing');
    expect(applyCommand(g, SPAWN_COMMAND)).toEqual({ ok: false, reason: 'wrong phase' });
    expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: 1, reason: 'wrong phase' }]);
    for (const cmd of GAMEPLAY_COMMANDS) expect(isWrongPhase(applyCommand(g, cmd))).toBe(false);
    expect(applyCommand(g, GRANT_COMMAND)).toEqual({ ok: true });
  });

  it('in the ended phase every command is rejected, debugGrant included', () => {
    const g = gameIn('ended');
    const all = [SPAWN_COMMAND, GRANT_COMMAND, ...GAMEPLAY_COMMANDS];
    for (const cmd of all) expect(applyCommand(g, cmd)).toEqual({ ok: false, reason: 'wrong phase' });
    expect(g.drainEvents()).toEqual(all.map(() => ({ type: 'rejected', nation: 1, reason: 'wrong phase' })));
    expect(g.nations[1].gold).toBe(0);
  });

  it('checks the nation before the phase', () => {
    for (const phase of ['spawn', 'playing', 'ended'] as const) {
      const g = gameIn(phase);
      expect(applyCommand(g, { ...SPAWN_COMMAND, nation: 9 })).toEqual({ ok: false, reason: 'unknown nation' });
      expect(applyCommand(g, { ...GRANT_COMMAND, nation: 2 })).toEqual({ ok: false, reason: 'eliminated' });
    }
  });

  it('gates on the phase before any command-specific validation; debugGrant still needs the debug flag', () => {
    const g = gameIn('spawn', false);
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: 1e9, ratio: 2 })).toEqual({ ok: false, reason: 'wrong phase' });
    expect(applyCommand(g, GRANT_COMMAND)).toEqual({ ok: false, reason: 'debug commands are disabled' });
  });
});

// Nation 1 holds no land in these tests, so the economy leaves its troops and gold alone.
describe('Game.step', () => {
  it('applies queued commands in order, then advances the tick', () => {
    const g = makeTestGame({ map: ['##'], nations: [{}, { alive: false }], debug: true });
    g.queue({ type: 'debugGrant', nation: 9, gold: 1 });
    g.queue({ type: 'debugGrant', nation: 1, gold: 5 });
    g.queue({ type: 'debugGrant', nation: 2, gold: 1 });
    expect(g.nations[1].gold).toBe(0);
    expect(g.tick).toBe(0);
    g.step();
    expect(g.tick).toBe(1);
    expect(g.nations[1].gold).toBe(5);
    expect(g.drainEvents()).toEqual([
      { type: 'rejected', nation: 9, reason: 'unknown nation' },
      { type: 'rejected', nation: 2, reason: 'eliminated' },
    ]);
  });

  it('consumes the queue so commands apply only once', () => {
    const g = makeTestGame({ map: ['##'], nations: [{}], debug: true });
    g.queue({ type: 'debugGrant', nation: 1, gold: 5 });
    g.step();
    g.step();
    expect(g.nations[1].gold).toBe(5);
    expect(g.tick).toBe(2);
  });

  it('a command rejected by an earlier command still lets later ones run', () => {
    const g = makeTestGame({ map: ['##'], nations: [{}], debug: true });
    g.queue({ type: 'spawn', nation: 1, tile: 1 });
    g.queue({ type: 'debugGrant', nation: 1, troops: 3 });
    g.step();
    expect(g.nations[1].troops).toBe(3);
  });
});

describe('Game events and alive()', () => {
  it('drainEvents returns events in emit order and clears them', () => {
    const g = makeTestGame({ map: ['##'], nations: [{}] });
    g.emit({ type: 'phase', phase: 'playing' });
    g.emit({ type: 'spawned', nation: 1, tile: 0 });
    expect(g.drainEvents()).toEqual([{ type: 'phase', phase: 'playing' }, { type: 'spawned', nation: 1, tile: 0 }]);
    expect(g.drainEvents()).toEqual([]);
  });

  it('alive() lists living nations in id order and skips the placeholder', () => {
    const g = makeTestGame({ map: ['##'], nations: [{}, { alive: false }, {}] });
    expect(g.alive().map((n) => n.id)).toEqual([1, 3]);
  });
});

describe('nationNames', () => {
  it('names are unique', () => expect(new Set(nationNames(new Rng(1), 40)).size).toBe(40));

  it('stays unique for large counts', () => expect(new Set(nationNames(new Rng(2), 600)).size).toBe(600));

  it('returns capitalised, non-empty names and none for a count of 0', () => {
    expect(nationNames(new Rng(1), 0)).toEqual([]);
    for (const name of nationNames(new Rng(4), 40)) expect(name).toMatch(/^[A-Z][a-z]{2,}$/);
  });

  it('is deterministic per seed', () => {
    expect(nationNames(new Rng(9), 10)).toEqual(nationNames(new Rng(9), 10));
    expect(nationNames(new Rng(9), 10)).not.toEqual(nationNames(new Rng(10), 10));
  });
});

describe('nationColor', () => {
  const PLAYER = 0x3b82f6;
  const rgbDistance = (a: number, b: number): number =>
    Math.hypot(((a >> 16) & 255) - ((b >> 16) & 255), ((a >> 8) & 255) - ((b >> 8) & 255), (a & 255) - (b & 255));
  const minPairwiseDistance = (colors: number[]): number => {
    let min = Infinity;
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) min = Math.min(min, rgbDistance(colors[i], colors[j]));
    }
    return min;
  };
  const botColors = (firstId: number, count: number): number[] =>
    Array.from({ length: count }, (_, i) => nationColor(firstId + i, false));

  it('the player is always blue', () => {
    expect(nationColor(0, true)).toBe(PLAYER);
    expect(nationColor(7, true)).toBe(PLAYER);
  });

  it('bots get valid, repeatable 24-bit colors', () => {
    for (let i = 1; i <= 41; i++) {
      const c = nationColor(i, false);
      expect(Number.isInteger(c) && c >= 0 && c <= 0xffffff).toBe(true);
      expect(nationColor(i, false)).toBe(c);
    }
  });

  it('the player and bot ids 1..40 are all clearly different in RGB space', () => {
    expect(minPairwiseDistance([PLAYER, ...botColors(1, 40)])).toBeGreaterThanOrEqual(50);
  });

  it('with a player present, bot ids 2..41 get 40 distinct colors, none the player\'s', () => {
    const colors = botColors(2, 40);
    expect(new Set(colors).size).toBe(40);
    expect(colors).not.toContain(PLAYER);
    expect(minPairwiseDistance([PLAYER, ...colors])).toBeGreaterThanOrEqual(50);
  });

  it('without a player, bot ids 1..40 get 40 distinct colors', () => {
    expect(new Set(botColors(1, 40)).size).toBe(40);
  });

  it('the palette repeats after 40 bots', () => {
    expect(nationColor(41, false)).toBe(nationColor(1, false));
    expect(nationColor(80, false)).toBe(nationColor(40, false));
  });
});

describe('makeTestGame', () => {
  it('starts in the playing phase, with no player and clean queues', () => {
    const g = makeTestGame({ map: ['#####'], owners: ['aab..'], nations: [{}, {}] });
    expect(g.phase).toBe('playing');
    expect(g.playerId).toBe(0);
    expect(g.tick).toBe(0);
    expect(g.debug).toBe(false);
    expect(g.checkVictory).toBe(false);
    expect(g.nations).toHaveLength(3);
    expect(g.drainEvents()).toEqual([]);
    expect(g.drainChangedTiles()).toEqual([]);
  });

  it('maps owner letters to nation ids and marks owners as spawned', () => {
    const g = makeTestGame({ map: ['####'], owners: ['a.c.'], nations: [{}, {}, {}] });
    expect(g.owner[0]).toBe(1);
    expect(g.owner[1]).toBe(0);
    expect(g.owner[2]).toBe(3);
    expect(g.nations.map((n) => n.spawned)).toEqual([false, true, false, true]);
    expect(g.nations.map((n) => n.tiles)).toEqual([0, 1, 0, 1]);
  });

  it('applies nation overrides after ownership so explicit values win', () => {
    const g = makeTestGame({
      map: ['###'], owners: ['ab.'],
      nations: [{ troops: 100, gold: 7, spawned: false }, { name: 'Zed', alive: false, tradeIncome: 2.5 }],
    });
    expect(g.nations[1]).toMatchObject({ troops: 100, gold: 7, spawned: false });
    expect(g.nations[2]).toMatchObject({ name: 'Zed', alive: false, tradeIncome: 2.5, spawned: true });
  });

  it('passes through debug, victory and difficulties', () => {
    const g = makeTestGame({
      map: ['##'], nations: [{}, {}, {}], debug: true, victory: true, difficulties: ['easy', 'hard'],
    });
    expect(g.debug).toBe(true);
    expect(g.checkVictory).toBe(true);
    expect(g.nations.slice(1).map((n) => n.difficulty)).toEqual(['easy', 'hard', 'normal']);
  });

  it('rejects a malformed owners grid', () => {
    expect(() => makeTestGame({ map: ['##'], owners: ['a'], nations: [{}] })).toThrow();
    expect(() => makeTestGame({ map: ['##', '##'], owners: ['aa'], nations: [{}] })).toThrow();
    expect(() => makeTestGame({ map: ['##'], owners: ['a!'], nations: [{}] })).toThrow();
    expect(() => makeTestGame({ map: ['##'], owners: ['ab'], nations: [{}] })).toThrow();
  });
});
