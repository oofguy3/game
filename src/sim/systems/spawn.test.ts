import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { GameEvent, TileIndex } from '../../shared/types';
import { Game } from '../core/game';
import { applyCommand } from '../core/commands';
import { distance, isLand, tileOf } from '../map/grid';
import { generateRandomMap } from '../map/randomMap';
import { mapFromAscii } from '../testing/asciiMap';
import { makeTestGame } from '../testing/fixtures';
import { Rng } from '../util/rng';
import { endSpawnPhase, randomSpawnTile, spawnNation } from './spawn';

const { radius, startTroops, startGold, minDistance, minDistanceFloor } = CONFIG.spawn;

const plains = (width: number, height: number): string[] => Array.from({ length: height }, () => '#'.repeat(width));

/** A game in the spawn phase with `bots` bot nations (ids 1..bots) and no player. */
function spawnGame(rows: string[], bots: number, spacing?: number): Game {
  const g = new Game({
    map: mapFromAscii(rows), seed: 1, player: null, bots: Array.from({ length: bots }, () => ({ difficulty: 'normal' as const })),
  });
  if (spacing !== undefined) g.spawnSpacing = spacing;
  return g;
}

/** Every in-bounds tile with dx²+dy² <= radius² around (cx, cy), computed independently of the implementation. */
function diskAround(g: Game, cx: number, cy: number): TileIndex[] {
  const tiles: TileIndex[] = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= g.map.width || y >= g.map.height) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) tiles.push(tileOf(g.map, x, y));
    }
  }
  return tiles;
}

const ownedBy = (g: Game, id: number): TileIndex[] => {
  const tiles: TileIndex[] = [];
  for (let t = 0; t < g.owner.length; t++) if (g.owner[t] === id) tiles.push(t);
  return tiles;
};

const rejections = (events: GameEvent[]) => events.filter((e) => e.type === 'rejected');

describe('Game.spawnSpacing', () => {
  it('is sqrt(landCount / (nationCount * 4)) when that lies between the floor and the cap', () => {
    // 400 land tiles, 2 nations: sqrt(400 / 8)
    expect(spawnGame(plains(20, 20), 2).spawnSpacing).toBeCloseTo(Math.sqrt(50), 10);
  });

  it('counts the player and the bots but not the unowned placeholder', () => {
    const g = new Game({ map: mapFromAscii(plains(20, 20)), seed: 1, player: { name: 'P' }, bots: [{ difficulty: 'easy' }] });
    expect(g.spawnSpacing).toBeCloseTo(Math.sqrt(50), 10);
  });

  it('only counts land, not water', () => {
    const rows = [...plains(40, 10), ...Array.from({ length: 10 }, () => '.'.repeat(40))];
    expect(spawnGame(rows, 2).spawnSpacing).toBeCloseTo(Math.sqrt(400 / 8), 10);
  });

  it(`is capped at minDistance (${minDistance})`, () => {
    expect(spawnGame(plains(100, 100), 1).spawnSpacing).toBe(minDistance);
  });

  it(`never drops below minDistanceFloor (${minDistanceFloor})`, () => {
    expect(spawnGame(plains(10, 10), 20).spawnSpacing).toBe(minDistanceFloor);
  });

  it('is the cap when there are no nations at all', () => {
    expect(spawnGame(plains(10, 10), 0).spawnSpacing).toBe(minDistance);
    expect(spawnGame(['.'], 0).spawnSpacing).toBe(minDistance);
  });
});

describe('spawnNation', () => {
  it('claims a radius-4 disk (49 tiles on open plains)', () => {
    const g = spawnGame(plains(21, 21), 1, 6);
    const centre = tileOf(g.map, 10, 10);
    expect(applyCommand(g, { type: 'spawn', nation: 1, tile: centre })).toEqual({ ok: true });
    const n = g.nations[1];
    expect(n.tiles).toBe(49);
    expect(ownedBy(g, 1)).toEqual(diskAround(g, 10, 10));
    // the disk is round: a corner of the bounding square is out, the axis extremes are in
    expect(g.owner[tileOf(g.map, 13, 13)]).toBe(0);
    expect(g.owner[tileOf(g.map, 14, 10)]).toBe(1);
    expect(g.owner[tileOf(g.map, 10, 6)]).toBe(1);
    expect(n).toMatchObject({ spawned: true, spawnTile: centre, troops: startTroops, gold: startGold });
    expect(g.drainEvents()).toEqual([{ type: 'spawned', nation: 1, tile: centre }]);
  });

  it('clips the disk at the map edge', () => {
    const g = spawnGame(plains(20, 20), 1, 6);
    expect(applyCommand(g, { type: 'spawn', nation: 1, tile: 0 }).ok).toBe(true);
    // one quadrant of the disk: 5 + 4 + 4 + 3 + 1
    expect(g.nations[1].tiles).toBe(17);
    expect(ownedBy(g, 1)).toEqual(diskAround(g, 0, 0));
  });

  it('leaves water, and land that somebody else already owns, out of the disk', () => {
    const rows = plains(21, 21).map((row, y) => (y === 10 ? row.slice(0, 12) + '..' + row.slice(14) : row));
    const g = spawnGame(rows, 2, 1);
    const taken = tileOf(g.map, 9, 10);
    g.setOwner(taken, 2);
    expect(applyCommand(g, { type: 'spawn', nation: 1, tile: tileOf(g.map, 10, 10) }).ok).toBe(true);
    const expected = diskAround(g, 10, 10).filter((t) => isLand(g.map, t) && t !== taken);
    expect(expected).toHaveLength(49 - 2 - 1);
    expect(ownedBy(g, 1)).toEqual(expected);
    expect(g.nations[1].tiles).toBe(expected.length);
    expect(g.owner[taken]).toBe(2);
    expect(g.nations[2].tiles).toBe(1);
  });

  it('rejects water, owned and too-close spawns with a reason and one event each', () => {
    const rows = plains(30, 20).map((row, y) => (y === 0 ? '.' + row.slice(1) : row));
    const g = spawnGame(rows, 2, 6);
    expect(applyCommand(g, { type: 'spawn', nation: 2, tile: tileOf(g.map, 10, 10) }).ok).toBe(true);
    g.drainEvents();

    const attempts: [TileIndex, string][] = [
      [0, 'not land'],
      [tileOf(g.map, 12, 10), 'tile is owned'],
      [tileOf(g.map, 15, 10), 'too close to another spawn'],
      [-1, 'off the map'],
      [g.map.width * g.map.height, 'off the map'],
      [2.5, 'off the map'],
      [Number.NaN, 'off the map'],
    ];
    for (const [tile, reason] of attempts) {
      expect(applyCommand(g, { type: 'spawn', nation: 1, tile })).toEqual({ ok: false, reason });
    }
    expect(g.drainEvents()).toEqual(attempts.map(([, reason]) => ({ type: 'rejected', nation: 1, reason })));
    expect(g.nations[1]).toMatchObject({ spawned: false, spawnTile: -1, tiles: 0, troops: 0, gold: 0 });
  });

  it('accepts a spawn exactly spawnSpacing away from another spawn', () => {
    const g = spawnGame(plains(30, 20), 2, 6);
    expect(spawnNation(g, g.nations[2], tileOf(g.map, 10, 10))).toEqual({ ok: true });
    expect(spawnNation(g, g.nations[1], tileOf(g.map, 16, 10))).toEqual({ ok: true });
    expect(spawnNation(g, g.nations[1], tileOf(g.map, 15, 10))).toEqual({ ok: false, reason: 'too close to another spawn' });
  });

  it('measures the Euclidean distance, not the per-axis or taxicab one', () => {
    const g = spawnGame(plains(40, 40), 2, 7);
    spawnNation(g, g.nations[2], tileOf(g.map, 10, 10));
    // 4 across and 4 down: 5.66 away, although the taxicab distance (8) clears the spacing
    expect(spawnNation(g, g.nations[1], tileOf(g.map, 14, 14))).toEqual({ ok: false, reason: 'too close to another spawn' });
    // 5 across and 5 down: 7.07 away, although neither axis alone clears the spacing
    expect(spawnNation(g, g.nations[1], tileOf(g.map, 15, 15))).toEqual({ ok: true });
  });

  it('checks every other spawned nation, not just the first', () => {
    const g = spawnGame(plains(40, 20), 3, 6);
    spawnNation(g, g.nations[2], tileOf(g.map, 5, 10));
    spawnNation(g, g.nations[3], tileOf(g.map, 30, 10));
    expect(spawnNation(g, g.nations[1], tileOf(g.map, 36, 10)).ok).toBe(true);
    expect(spawnNation(g, g.nations[1], tileOf(g.map, 35, 10))).toEqual({ ok: false, reason: 'too close to another spawn' });
  });

  it('is only valid in the spawn phase', () => {
    const g = spawnGame(plains(20, 20), 1, 6);
    g.phase = 'playing';
    expect(spawnNation(g, g.nations[1], 5)).toEqual({ ok: false, reason: 'wrong phase' });
    g.phase = 'ended';
    expect(spawnNation(g, g.nations[1], 5)).toEqual({ ok: false, reason: 'wrong phase' });
    expect(g.nations[1].spawned).toBe(false);
    expect(g.tick).toBe(0);
  });

  it('player can move their spawn during the phase', () => {
    const g = spawnGame(plains(40, 20), 2, 6);
    const first = tileOf(g.map, 8, 10);
    const second = tileOf(g.map, 30, 10);
    applyCommand(g, { type: 'spawn', nation: 1, tile: first });
    g.nations[1].troops += 123;
    g.nations[1].gold += 456;
    g.drainEvents();
    g.drainChangedTiles();

    expect(applyCommand(g, { type: 'spawn', nation: 1, tile: second })).toEqual({ ok: true });
    const n = g.nations[1];
    expect(n).toMatchObject({ spawned: true, spawnTile: second, tiles: 49, troops: startTroops, gold: startGold });
    expect(ownedBy(g, 1)).toEqual(diskAround(g, 30, 10));
    for (const t of diskAround(g, 8, 10)) expect(g.owner[t]).toBe(0);
    expect(g.drainEvents()).toEqual([{ type: 'spawned', nation: 1, tile: second }]);
    // ownership bookkeeping followed the move
    expect(n.sumX / n.tiles).toBe(30);
    expect(n.sumY / n.tiles).toBe(10);
    expect(n.border.size).toBeGreaterThan(0);
    for (const t of n.border) expect(distance(g.map, t, second)).toBeLessThanOrEqual(radius);
    expect(n.stats.peakTiles).toBe(49);
  });

  it('allows moving onto or next to your own old disk', () => {
    const g = spawnGame(plains(30, 30), 1, 6);
    spawnNation(g, g.nations[1], tileOf(g.map, 15, 15));
    expect(spawnNation(g, g.nations[1], tileOf(g.map, 16, 15))).toEqual({ ok: true });
    expect(ownedBy(g, 1)).toEqual(diskAround(g, 16, 15));
    expect(spawnNation(g, g.nations[1], tileOf(g.map, 16, 15))).toEqual({ ok: true });
    expect(g.nations[1].tiles).toBe(49);
  });

  it('moving away only releases your own tiles', () => {
    const g = spawnGame(plains(30, 20), 2, 6);
    spawnNation(g, g.nations[1], tileOf(g.map, 8, 10));
    spawnNation(g, g.nations[2], tileOf(g.map, 14, 10));
    const theirs = ownedBy(g, 2);
    expect(theirs.length).toBeLessThan(49); // nation 1 got the overlap
    spawnNation(g, g.nations[1], tileOf(g.map, 25, 3));
    expect(ownedBy(g, 2)).toEqual(theirs);
    expect(g.nations[2].tiles).toBe(theirs.length);
  });

  it('a rejected move leaves the old spawn untouched', () => {
    const g = spawnGame(plains(30, 20), 2, 6);
    spawnNation(g, g.nations[1], tileOf(g.map, 8, 10));
    spawnNation(g, g.nations[2], tileOf(g.map, 25, 10));
    const before = ownedBy(g, 1);
    expect(spawnNation(g, g.nations[1], tileOf(g.map, 20, 10)).ok).toBe(false);
    expect(ownedBy(g, 1)).toEqual(before);
    expect(g.nations[1].spawnTile).toBe(tileOf(g.map, 8, 10));
  });

  it('does not treat a nation that has not spawned as sitting on the first tile', () => {
    const g = spawnGame(plains(20, 20), 2, 6);
    expect(g.nations[2].spawnTile).toBe(-1);
    expect(spawnNation(g, g.nations[1], 0).ok).toBe(true);
  });
});

describe('randomSpawnTile', () => {
  const smallMap = () => generateRandomMap(3, 'small');

  it('only returns unowned land at least the spacing from every spawn', () => {
    const g = new Game({ map: smallMap(), seed: 3, player: { name: 'P' }, bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }] });
    const first = randomSpawnTile(g, new Rng(1));
    expect(first).not.toBeNull();
    expect(spawnNation(g, g.nations[1], first!).ok).toBe(true);
    for (let seed = 0; seed < 100; seed++) {
      const tile = randomSpawnTile(g, new Rng(seed));
      expect(tile).not.toBeNull();
      expect(isLand(g.map, tile!)).toBe(true);
      expect(g.owner[tile!]).toBe(0);
      expect(distance(g.map, tile!, first!)).toBeGreaterThanOrEqual(g.spawnSpacing);
    }
  });

  it('is deterministic for a given rng and varies with its seed', () => {
    const g = new Game({ map: smallMap(), seed: 3, player: null, bots: [{ difficulty: 'easy' }] });
    expect(randomSpawnTile(g, new Rng(7))).toBe(randomSpawnTile(g, new Rng(7)));
    const tiles = new Set(Array.from({ length: 20 }, (_, seed) => randomSpawnTile(g, new Rng(seed))));
    expect(tiles.size).toBeGreaterThan(10);
  });

  it('uses only the rng it is given', () => {
    const make = () => new Game({ map: smallMap(), seed: 3, player: null, bots: [{ difficulty: 'easy' }] });
    const a = make();
    const b = make();
    randomSpawnTile(a, new Rng(7));
    randomSpawnTile(a, new Rng(8), 2);
    expect(a.rng.next()).toBe(b.rng.next());
  });

  it('takes the spacing from the call, defaulting to the game spacing', () => {
    const g = spawnGame(plains(60, 1), 2, 6);
    spawnNation(g, g.nations[1], 30);
    for (let seed = 0; seed < 30; seed++) {
      expect(Math.abs(randomSpawnTile(g, new Rng(seed), 25)! - 30)).toBeGreaterThanOrEqual(25);
      expect(Math.abs(randomSpawnTile(g, new Rng(seed))! - 30)).toBeGreaterThanOrEqual(6);
    }
  });

  it('relaxes the spacing by 25% at a time until a tile qualifies', () => {
    // A 40-tile strip with a spawn in the middle: nothing is 30 or 22.5 tiles away, 16.875 is the first spacing that works.
    const g = spawnGame(plains(40, 1), 2, 30);
    spawnNation(g, g.nations[1], 20);
    for (let seed = 0; seed < 30; seed++) {
      const tile = randomSpawnTile(g, new Rng(seed))!;
      expect(distance(g.map, tile, 20)).toBeGreaterThanOrEqual(30 * 0.75 * 0.75);
      expect([0, 1, 2, 3, 37, 38, 39]).toContain(tile);
    }
  });

  it('accepts any unowned land once the spacing would drop below the floor', () => {
    // Spawn at 5 owns tiles 1..9; the only free land, 0 and 10, is 5 away, under the floor of 6.
    const g = spawnGame(plains(11, 1), 2, 30);
    spawnNation(g, g.nations[1], 5);
    expect(minDistanceFloor).toBeGreaterThan(5);
    const found = new Set<TileIndex>();
    for (let seed = 0; seed < 40; seed++) found.add(randomSpawnTile(g, new Rng(seed))!);
    expect([...found].sort((a, b) => a - b)).toEqual([0, 10]);
  });

  it('never returns water', () => {
    const g = spawnGame(['#.#.#.#.', '.#.#.#.#', '#.#.#.#.'], 1, 1);
    for (let seed = 0; seed < 100; seed++) expect(isLand(g.map, randomSpawnTile(g, new Rng(seed))!)).toBe(true);
  });

  it('finds the last free tile on a nearly full map', () => {
    const g = spawnGame(plains(100, 100), 1, 30);
    for (let t = 0; t < g.owner.length; t++) if (t !== 4321) g.setOwner(t, 1);
    for (let seed = 0; seed < 5; seed++) expect(randomSpawnTile(g, new Rng(seed))).toBe(4321);
  });

  it('returns null when no unowned land is left or there is no land at all', () => {
    const full = spawnGame(plains(9, 1), 2, 6);
    spawnNation(full, full.nations[1], 4);
    expect(full.nations[1].tiles).toBe(9);
    expect(randomSpawnTile(full, new Rng(1))).toBeNull();
    expect(randomSpawnTile(spawnGame(['....'], 1), new Rng(1))).toBeNull();
  });
});

describe('endSpawnPhase', () => {
  it('auto-spawns everyone and switches to playing', () => {
    const g = new Game({
      map: mapFromAscii(plains(60, 40)), seed: 4, player: { name: 'P' }, bots: [{ difficulty: 'easy' }, { difficulty: 'hard' }],
    });
    endSpawnPhase(g);
    expect(g.phase).toBe('playing');
    for (const n of g.alive()) {
      expect(n).toMatchObject({ spawned: true, troops: startTroops, gold: startGold });
      expect(n.tiles).toBeGreaterThan(0);
      expect(g.owner[n.spawnTile]).toBe(n.id);
    }
    const events = g.drainEvents();
    expect(events.map((e) => e.type)).toEqual(['spawned', 'spawned', 'spawned', 'phase']);
    expect(events.at(-1)).toEqual({ type: 'phase', phase: 'playing' });
  });

  it('spawns the remaining nations in id order and leaves earlier spawns alone', () => {
    const g = new Game({
      map: mapFromAscii(plains(60, 40)), seed: 4, player: { name: 'P' },
      bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }, { difficulty: 'easy' }],
    });
    const chosen = tileOf(g.map, 30, 20);
    // nation 3 picks its own spot; nations 1, 2 and 4 are placed at random
    expect(spawnNation(g, g.nations[3], chosen).ok).toBe(true);
    g.drainEvents();
    endSpawnPhase(g);
    expect(g.nations[3].spawnTile).toBe(chosen);
    expect(g.nations[3].tiles).toBe(49);
    expect(g.drainEvents().flatMap((e) => (e.type === 'spawned' ? [e.nation] : []))).toEqual([1, 2, 4]);
  });

  it('keeps random spawns at least the spacing apart when there is room', () => {
    const g = new Game({
      map: mapFromAscii(plains(120, 80)), seed: 4, player: null, bots: Array.from({ length: 6 }, () => ({ difficulty: 'easy' as const })),
    });
    endSpawnPhase(g);
    const tiles = g.alive().map((n) => n.spawnTile);
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        expect(distance(g.map, tiles[i], tiles[j])).toBeGreaterThanOrEqual(g.spawnSpacing);
      }
    }
  });

  it('is deterministic per seed', () => {
    const run = (seed: number) => {
      const g = new Game({
        map: generateRandomMap(2, 'small'), seed, player: null, bots: Array.from({ length: 8 }, () => ({ difficulty: 'easy' as const })),
      });
      endSpawnPhase(g);
      return g.nations.map((n) => n.spawnTile);
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });

  it('marks a nation dead when there is no land left for it', () => {
    const g = spawnGame(['##'], 3);
    endSpawnPhase(g);
    expect(g.phase).toBe('playing');
    expect(g.nations.map((n) => [n.alive, n.spawned])).toEqual([[false, false], [true, true], [false, false], [false, false]]);
    expect(g.alive().map((n) => n.id)).toEqual([1]);
    // the two left out are knocked out by no one, and the feed hears of it
    expect(g.drainEvents()).toEqual([
      { type: 'spawned', nation: 1, tile: g.nations[1].spawnTile },
      { type: 'eliminated', nation: 2, by: 0 },
      { type: 'eliminated', nation: 3, by: 0 },
      { type: 'phase', phase: 'playing' },
    ]);
  });

  it('skips nations that are already dead', () => {
    const g = spawnGame(plains(30, 30), 2);
    g.nations[1].alive = false;
    endSpawnPhase(g);
    expect(g.nations[1]).toMatchObject({ alive: false, spawned: false, tiles: 0 });
    expect(g.nations[2].spawned).toBe(true);
  });

  it('spawns all 41 nations on a small random map', () => {
    const g = new Game({
      map: generateRandomMap(3, 'small'), seed: 3, player: { name: 'P' },
      bots: Array.from({ length: 40 }, () => ({ difficulty: 'easy' as const })), spawnTicks: 1,
    });
    g.step();
    // the phase ends on this step, before the economy has run
    expect(g.phase).toBe('playing');
    expect(g.alive().every((n) => n.troops === startTroops && n.gold === startGold)).toBe(true);
    g.step();
    expect(g.alive().filter((n) => n.spawned)).toHaveLength(41);
    expect(g.alive().every((n) => n.tiles > 0)).toBe(true);
    expect(new Set(g.alive().map((n) => n.spawnTile)).size).toBe(41);
  });
});

describe('Game.step in the spawn phase', () => {
  const newGame = (spawnTicks: number) => new Game({
    map: mapFromAscii(plains(30, 30)), seed: 1, player: { name: 'P' }, bots: [{ difficulty: 'easy' }], spawnTicks,
  });

  it('ends the phase on the step where tick reaches spawnEndsAt', () => {
    const g = newGame(3);
    g.step();
    g.step();
    expect([g.tick, g.phase]).toEqual([2, 'spawn']);
    expect(g.drainEvents()).toEqual([]);
    g.step();
    expect([g.tick, g.phase]).toEqual([3, 'playing']);
    expect(g.drainEvents().filter((e) => e.type === 'phase')).toEqual([{ type: 'phase', phase: 'playing' }]);
    g.step();
    expect([g.tick, g.phase]).toEqual([4, 'playing']);
    expect(g.drainEvents()).toEqual([]);
  });

  it('applies queued spawns before the phase ends, even on the last step', () => {
    const g = newGame(1);
    const tile = tileOf(g.map, 5, 5);
    g.queue({ type: 'spawn', nation: 1, tile });
    g.step();
    expect(g.phase).toBe('playing');
    expect(g.nations[1].spawnTile).toBe(tile);
    expect(g.nations[2].spawned).toBe(true);
    expect(rejections(g.drainEvents())).toEqual([]);
  });

  it('a spawn queued after the phase ended is rejected', () => {
    const g = newGame(1);
    g.step();
    g.drainEvents();
    g.queue({ type: 'spawn', nation: 1, tile: 0 });
    g.step();
    expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: 1, reason: 'wrong phase' }]);
  });

  it('only advances the tick when the game is not in the spawn phase', () => {
    const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{}] });
    g.spawnEndsAt = 0;
    g.step();
    expect([g.tick, g.phase]).toEqual([1, 'playing']);
    expect(g.drainEvents()).toEqual([]);
  });
});
