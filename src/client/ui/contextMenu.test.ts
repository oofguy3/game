import { describe, expect, it } from 'vitest';
import type { Command } from '../../shared/types';
import { makeClientState } from '../testing/fixtures';
import { menuEntries } from './contextMenu';
import type { MenuEntry } from './contextMenu';

/** a's coast on the left, b's land on the right touching it, c's island far right, water in between. */
const MAP = [
  '....................',
  '.######.........###.',
  '.######.........###.',
  '.######.........###.',
  '....................',
];
const OWNERS = [
  '....................',
  '.aaabbb.........ccc.',
  '.aaabbb.........ccc.',
  '.aaabbb.........ccc.',
  '....................',
];
const W = 20;
const tile = (x: number, y: number) => y * W + x;

function setup() {
  const { state, info } = makeClientState(MAP, OWNERS);
  const sent: Command[] = [];
  const opened: number[] = [];
  const ctx = { state, info, send: (c: Command) => sent.push(c), ratio: () => 0.3, openDiplomacy: (id: number) => opened.push(id) };
  return { state, info, sent, opened, at: (x: number, y: number) => menuEntries(ctx, tile(x, y)) };
}

const labels = (es: MenuEntry[]) => es.map((e) => e.label);
const entry = (es: MenuEntry[], label: string) => es.find((e) => e.label.startsWith(label));

describe('context menu entries', () => {
  it('on an enemy tile: attack, air strikes (greyed without an airport) and diplomacy', () => {
    const s = setup();
    const es = s.at(4, 2);
    expect(labels(es)).toEqual(['Attack', 'Bomb', 'Paratroopers', 'Diplomacy with N2']);
    expect(entry(es, 'Bomb')).toMatchObject({ disabled: true, detail: 'no airport' });
    entry(es, 'Attack')!.run!();
    entry(es, 'Diplomacy')!.run!();
    expect(s.sent).toEqual([{ type: 'attack', nation: 1, tile: tile(4, 2), ratio: 0.3, allowBoat: true }]);
    expect(s.opened).toEqual([2]);
  });

  it('bomb and paratroopers need a finished airport in range', () => {
    const s = setup();
    s.state.buildings = [{ id: 7, type: 'airport', owner: 1, tile: tile(2, 2), underConstruction: true }];
    expect(entry(s.at(4, 2), 'Bomb')).toMatchObject({ disabled: true, detail: 'no airport' });
    s.state.buildings[0].underConstruction = false;
    const es = s.at(4, 2);
    expect(entry(es, 'Bomb')!.disabled).toBeFalsy();
    entry(es, 'Bomb')!.run!();
    entry(es, 'Paratroopers')!.run!();
    expect(s.sent).toEqual([
      { type: 'bomb', nation: 1, tile: tile(4, 2) },
      { type: 'paradrop', nation: 1, tile: tile(4, 2), ratio: 0.3 },
    ]);
  });

  it('greys out air strikes on our own land, an ally, or (bombs) free land', () => {
    const s = setup();
    s.state.buildings = [{ id: 7, type: 'airport', owner: 1, tile: tile(2, 2), underConstruction: false }];
    expect(entry(s.at(2, 1), 'Bomb')).toMatchObject({ disabled: true, detail: 'your land' });
    s.state.nations.get(2)!.relationToPlayer = 'allied';
    expect(entry(s.at(4, 2), 'Bomb')).toMatchObject({ disabled: true, detail: 'allied' });
    expect(entry(s.at(4, 2), 'Attack')).toMatchObject({ disabled: true, detail: 'allied' });
  });

  it('send boat only on a coast that is not ours', () => {
    const s = setup();
    expect(labels(s.at(16, 2))).toContain('Send boat');
    expect(labels(s.at(17, 2))).not.toContain('Send boat'); // the island's middle has no beach
    entry(s.at(16, 2), 'Send boat')!.run!();
    expect(s.sent).toEqual([{ type: 'boat', nation: 1, tile: tile(16, 2), ratio: 0.3 }]);
    expect(labels(s.at(2, 2))).not.toContain('Send boat');
  });

  it('on our land: build menu with prices, coast-only buildings only on the coast', () => {
    const s = setup();
    s.state.nations.get(1)!.gold = 2000;
    const build = entry(s.at(2, 2), 'Build')!;
    expect(build.submenu!.map((e) => e.label)).toEqual(['City', 'Factory', 'Barracks', 'Bank', 'Defense post', 'Fortress',
      'Port', 'Naval base', 'Airport', 'Anti-air gun', 'Radar station']);
    expect(entry(build.submenu!, 'City')).toMatchObject({ disabled: false, detail: '1k' });
    expect(entry(build.submenu!, 'Fortress')).toMatchObject({ disabled: true });
    // (2,2) is inland: no port there
    expect(entry(build.submenu!, 'Port')).toMatchObject({ disabled: true, detail: 'coast only' });
    s.state.nations.get(1)!.gold = 1e6;
    expect(entry(entry(s.at(1, 2), 'Build')!.submenu!, 'Port')!.disabled).toBe(false);
    entry(build.submenu!, 'City')!.run!();
    expect(s.sent).toEqual([{ type: 'build', nation: 1, building: 'city', tile: tile(2, 2) }]);
    expect(labels(s.at(2, 2))).not.toContain('Attack');
  });

  it('build warship at our naval base and fighter at our airport', () => {
    const s = setup();
    s.state.buildings = [
      { id: 3, type: 'navalBase', owner: 1, tile: tile(1, 1), underConstruction: false },
      { id: 4, type: 'airport', owner: 1, tile: tile(2, 3), underConstruction: false },
    ];
    entry(s.at(1, 1), 'Build warship')!.run!();
    entry(s.at(2, 3), 'Build fighter')!.run!();
    expect(labels(s.at(2, 3))).not.toContain('Build warship');
    expect(s.sent).toEqual([
      { type: 'buildUnit', nation: 1, unit: 'warship', buildingId: 3 },
      { type: 'buildUnit', nation: 1, unit: 'fighter', buildingId: 4 },
    ]);
  });

  it('on water: move the nearest warship there', () => {
    const s = setup();
    expect(labels(s.at(10, 2))).not.toContain('Move nearest warship here');
    s.state.units = [
      { id: 21, type: 'warship', owner: 1, x: 8, y: 0, troops: 0 },
      { id: 22, type: 'warship', owner: 1, x: 12, y: 4, troops: 0 },
      { id: 23, type: 'warship', owner: 2, x: 10, y: 3, troops: 0 },
    ];
    const es = s.at(13, 3);
    expect(labels(es)).toEqual(['Bomb', 'Paratroopers', 'Move nearest warship here']);
    entry(es, 'Move')!.run!();
    expect(s.sent).toEqual([{ type: 'moveUnit', nation: 1, unitId: 22, tile: tile(13, 3) }]);
    expect(entry(es, 'Paratroopers')).toMatchObject({ disabled: true, detail: 'not land' });
  });

  it('only orders a warship on the same sea as the click', () => {
    // a's land holds a lake (x 2–4, y 2–3), cut off from the sea around it
    const map = ['....................', '.#######............', '.#...###............', '.#...###............', '.#######............', '....................', '....................'];
    const owners = ['....................', '.aaaaaaa............', '.a...aaa............', '.a...aaa............', '.aaaaaaa............', '....................', '....................'];
    const { state, info } = makeClientState(map, owners);
    const sent: Command[] = [];
    const ctx = { state, info, send: (c: Command) => sent.push(c), ratio: () => 0.3, openDiplomacy: () => {} };
    const lake = { id: 31, type: 'warship' as const, owner: 1, x: 3, y: 2, troops: 0 };
    const sea = { id: 32, type: 'warship' as const, owner: 1, x: 14, y: 6, troops: 0 };
    // the lake ship is nearer, but only the sea ship can sail to the sea
    state.units = [lake, sea];
    entry(menuEntries(ctx, tile(8, 2)), 'Move')!.run!();
    expect(sent).toEqual([{ type: 'moveUnit', nation: 1, unitId: 32, tile: tile(8, 2) }]);
    // and on the lake, the lake ship
    entry(menuEntries(ctx, tile(4, 3)), 'Move')!.run!();
    expect(sent[1]).toEqual({ type: 'moveUnit', nation: 1, unitId: 31, tile: tile(4, 3) });
    // no warship on this sea: greyed out, saying why
    state.units = [lake];
    expect(entry(menuEntries(ctx, tile(8, 2)), 'Move')).toMatchObject({ disabled: true, detail: 'none on this sea' });
  });

  it('nothing while choosing a start', () => {
    const s = setup();
    s.state.phase = 'spawn';
    expect(s.at(4, 2)).toEqual([]);
  });
});
