import { describe, expect, it } from 'vitest';
import { makeClientState } from './testing/fixtures';
import { farthestTile, findLandTile } from './testApi';

/** a's block on the left, b's island on the right, free land at the bottom left. */
const MAP = [
  '............',
  '.#######....',
  '.#######.##.',
  '.#######.##.',
  '.#######....',
  '.#######....',
  '.###........',
  '............',
];
const OWNERS = [
  '............',
  '.aaaaaaa....',
  '.aaaaaaa.bb.',
  '.aaaaaaa.bb.',
  '.aaaaaaa....',
  '.aaaaaaa....',
  '............',
  '............',
];

const at = (t: number | null, width = 12) => (t === null ? null : [t % width, Math.floor(t / width)]);

describe('findLandTile', () => {
  it('bomb-target: the enemy tile nearest our finished airport, within range', () => {
    const { state, info } = makeClientState(MAP, OWNERS);
    expect(findLandTile(state, info, 'bomb-target')).toBeNull();
    state.buildings = [{ id: 1, type: 'airport', owner: 1, tile: 3 * 12 + 6, underConstruction: false }];
    expect(at(findLandTile(state, info, 'bomb-target'))).toEqual([9, 3]);
    state.nations.get(2)!.relationToPlayer = 'allied';
    expect(findLandTile(state, info, 'bomb-target')).toBeNull();
  });

  it('player-interior: inland, all around ours, clear of buildings', () => {
    const { state, info } = makeClientState(MAP, OWNERS);
    const t = findLandTile(state, info, 'player-interior')!;
    const [x, y] = at(t)!;
    expect(x).toBeGreaterThanOrEqual(2);
    expect(x).toBeLessThanOrEqual(6);
    expect(y).toBeGreaterThanOrEqual(2);
    expect(y).toBeLessThanOrEqual(4);
    // a building rules out everything within 3 tiles
    state.buildings = [{ id: 1, type: 'city', owner: 1, tile: 3 * 12 + 2, underConstruction: false }];
    expect(at(findLandTile(state, info, 'player-interior'))![0]).toBe(6);
    state.buildings.push({ id: 2, type: 'city', owner: 1, tile: 3 * 12 + 6, underConstruction: true });
    expect(findLandTile(state, info, 'player-interior')).toBeNull();
  });

  it('player-coastal: our land by the sea, clear of buildings', () => {
    const { state, info } = makeClientState(MAP, OWNERS);
    const t = findLandTile(state, info, 'player-coastal')!;
    expect(state.owner[t]).toBe(1);
    expect(info.coastal[t]).toBe(1);
  });

  it('overseas-enemy: an enemy coast on another landmass across our sea', () => {
    const { state, info } = makeClientState(MAP, OWNERS);
    const t = findLandTile(state, info, 'overseas-enemy')!;
    expect(state.owner[t]).toBe(2);
    expect(info.landmass[t]).not.toBe(info.landmass[12 + 1]);
    // with every enemy on our land, its coast away from us (still a boat trip)
    const joined = makeClientState(['......', '.####.', '......'], ['......', '.a.bb.', '......']);
    expect(at(findLandTile(joined.state, joined.info, 'overseas-enemy'), 6)).toEqual([3, 1]);
    const touching = makeClientState(['......', '.###..', '......'], ['......', '.ab...', '......']);
    expect(findLandTile(touching.state, touching.info, 'overseas-enemy')).toBeNull();
  });

  it('coastal-unowned: a free coast far from everyone before spawning, next to us after', () => {
    const { state, info } = makeClientState(MAP, OWNERS.map((r) => r.replace(/a/g, '.')));
    state.nations.get(1)!.tiles = 0;
    const spawn = findLandTile(state, info, 'coastal-unowned')!;
    expect(state.owner[spawn]).toBe(0);
    expect(info.coastal[spawn]).toBe(1);
    // with others on the map: at a safe distance, but no farther than that needs
    const wide = makeClientState(['.'.repeat(200), '#'.repeat(200), '.'.repeat(200)], ['', 'b' + '.'.repeat(199), '']);
    wide.state.nations.get(1)!.tiles = 0;
    expect(at(findLandTile(wide.state, wide.info, 'coastal-unowned'), 200)).toEqual([60, 1]);
    const mine = makeClientState(MAP, OWNERS);
    const next = findLandTile(mine.state, mine.info, 'coastal-unowned')!;
    expect(at(next)![1]).toBe(6); // the free strip below a's block
    expect(mine.info.coastal[next]).toBe(1);
  });

  it('enemy: prefers land touching ours, else the nearest', () => {
    const { state, info } = makeClientState(MAP, OWNERS);
    expect(state.owner[findLandTile(state, info, 'enemy')!]).toBe(2);
    const touching = makeClientState(['#####'], ['aab.b']);
    expect(findLandTile(touching.state, touching.info, 'enemy')).toBe(2);
    // of several touching ours, the one nearest our middle
    const wide = makeClientState(['#######', '#######', '#######'], ['bbbbbbb', 'baaaaab', 'bbbbbbb']);
    expect(at(findLandTile(wide.state, wide.info, 'enemy'), 7)).toEqual([3, 0]);
  });
});

describe('farthestTile', () => {
  it('finds the water tile farthest from land and the land tile farthest from water', () => {
    // a 9×5 lake on the left of a 9×5 field of land
    const map = Array.from({ length: 5 }, () => '.........#########');
    const { info } = makeClientState(map, map.map(() => '.'.repeat(18)));
    expect(at(farthestTile(info, 'water'), 18)?.[0]).toBe(0);
    expect(at(farthestTile(info, 'land'), 18)?.[0]).toBe(17);
    const allLand = makeClientState(['###'], ['...']).info;
    expect(farthestTile(allLand, 'water')).toBeNull();
  });
});
