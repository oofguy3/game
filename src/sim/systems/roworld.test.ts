import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import { applyCommand } from '../core/commands';
import { COUNTRIES } from '../core/countries';
import { Game } from '../core/game';
import { generateBoxMap } from '../map/boxMap';
import { tileOf } from '../map/grid';
import { mapFromAscii } from '../testing/asciiMap';
import { makeTestGame } from '../testing/fixtures';
import { stepAttacks } from './attacks';
import { tileCaptureCost } from './combat';
import { breakAlliance } from './diplomacy';
import { clearFallout, markFallout } from './nukes';
import { placeTribes, stepTribes, TRIBE_NAMES } from './tribes';
import { checkVictory } from './victory';
import { spawnUnit } from './units';

const plains = (w: number, h: number): string[] => Array.from({ length: h }, () => '#'.repeat(w));

describe('spawn protection', () => {
  it('blocks attacks on a shielded nation and still allows empty land and tribes', () => {
    const g = makeTestGame({
      map: ['####', '####'],
      owners: ['aab.', 'c...'],
      nations: [{ troops: 4000 }, { troops: 4000 }, { troops: 500, role: 'tribe', shield: false }],
    });
    g.protectUntil = 500;
    g.tick = 10;
    const at = (x: number, y: number) => tileOf(g.map, x, y);
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: at(2, 0), ratio: 0.5 })).toEqual({ ok: false, reason: 'protected' });
    expect(g.nations[1].troops).toBe(4000);
    expect(g.nations[1].shield).toBe(true);

    expect(applyCommand(g, { type: 'attack', nation: 1, tile: at(1, 1), ratio: 0.1 })).toEqual({ ok: true });
    expect(g.nations[1].shield).toBe(true);

    expect(applyCommand(g, { type: 'attack', nation: 1, tile: at(0, 1), ratio: 0.1 })).toEqual({ ok: true });
    expect(g.nations[1].shield).toBe(true);
    expect(g.relations.get(1, 3)).toBe('war');
  });

  it('attacking another nation drops the shield, and the window ending drops it for everyone', () => {
    const g = makeTestGame({
      map: ['######'], owners: ['aaabbb'], nations: [{ troops: 4000 }, { troops: 4000 }],
    });
    g.protectUntil = 500;
    g.tick = 10;
    g.nations[2].shield = false;
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: tileOf(g.map, 3, 0), ratio: 0.2 })).toEqual({ ok: true });
    expect(g.nations[1].shield).toBe(false);
    expect(applyCommand(g, { type: 'attack', nation: 2, tile: tileOf(g.map, 2, 0), ratio: 0.2 })).toEqual({ ok: true });

    const quiet = makeTestGame({
      map: ['####'], owners: ['aabb'], nations: [{ troops: 1000 }, { troops: 1000 }],
    });
    quiet.protectUntil = 40;
    quiet.tick = 40;
    expect(applyCommand(quiet, { type: 'attack', nation: 1, tile: tileOf(quiet.map, 2, 0), ratio: 0.2 })).toEqual({ ok: true });
  });

  it('the war opens a protection window', () => {
    const g = new Game({
      map: mapFromAscii(plains(20, 8)), seed: 3, player: { name: 'You' }, bots: [{ difficulty: 'easy' }], spawnTicks: 1,
    });
    g.step();
    expect(g.phase).toBe('playing');
    expect(g.protectUntil).toBe(1 + CONFIG.spawn.protectTicks);
    expect(g.nations[1].shield).toBe(true);
  });
});

describe('traitor', () => {
  it('breaking an alliance halves the cost to take the betrayer’s land for traitorTicks', () => {
    const g = makeTestGame({
      map: ['######'], owners: ['aaabbb'], nations: [{ troops: 2000 }, { troops: 2000 }],
    });
    g.relations.set(1, 2, 'allied');
    const tile = tileOf(g.map, 3, 0);
    const before = tileCaptureCost(g, 1, tile);
    expect(breakAlliance(g, 2, 1)).toEqual({ ok: true });
    expect(g.nations[2].traitorUntil).toBe(g.tick + CONFIG.diplomacy.traitorTicks);
    expect(tileCaptureCost(g, 1, tile)).toBeCloseTo(before * CONFIG.diplomacy.traitorAttackCost);
    g.tick = g.nations[2].traitorUntil;
    expect(tileCaptureCost(g, 1, tile)).toBeCloseTo(before);
  });
});

describe('nukes and fallout', () => {
  function armed(): Game {
    const g = makeTestGame({
      map: ['#'.repeat(48)],
      owners: [`${'a'.repeat(6)}${'.'.repeat(36)}${'b'.repeat(6)}`],
      nations: [{ gold: 200_000, troops: 8000 }, { troops: 8000 }],
    });
    g.buildings.add({ id: g.nextId(), type: 'missileSilo', owner: 1, tile: tileOf(g.map, 1, 0), ticksLeft: 0, cooldown: 0 });
    g.nations[1].buildingCounts.missileSilo = 1;
    return g;
  }

  it('an atom bomb leaves fallout that is excluded from the land-share win', () => {
    const g = armed();
    const target = tileOf(g.map, 45, 0);
    expect(applyCommand(g, { type: 'nuke', nation: 1, tile: target, kind: 'atom' })).toEqual({ ok: true });
    expect(g.nations[1].shield).toBe(false);
    for (let i = 0; i < 12; i++) g.step();
    expect([...g.units.values()].some((u) => u.type === 'missile')).toBe(false);
    expect(g.falloutCount).toBeGreaterThan(0);
    expect(g.fallout[target]).toBe(1);
    expect(g.drainEvents().some((e) => e.type === 'nuked')).toBe(true);

    // 8 of 10 land tiles is a win, until two of them are fallout: 6 of the remaining 8 is only 75%.
    const race = makeTestGame({
      map: ['##########'], owners: ['aaaaaaaa..'], nations: [{ troops: 100 }, { troops: 100 }], victory: true,
    });
    expect(checkVictory(race)).toEqual({ winners: [1], reason: 'landShare' });
    markFallout(race, 0);
    markFallout(race, 1);
    expect(checkVictory(race)).toBeNull();
    clearFallout(race, 0);
    clearFallout(race, 1);
    expect(checkVictory(race)).toEqual({ winners: [1], reason: 'landShare' });
  });

  it('needs a silo, and a SAM shoots the warhead down before it blooms', () => {
    const bare = makeTestGame({
      map: ['####'], owners: ['aabb'], nations: [{ gold: 100_000, troops: 1000 }, { troops: 1000 }],
    });
    expect(applyCommand(bare, { type: 'nuke', nation: 1, tile: tileOf(bare.map, 2, 0), kind: 'atom' }))
      .toEqual({ ok: false, reason: 'no missile silo' });

    const g = armed();
    g.buildings.add({ id: g.nextId(), type: 'samLauncher', owner: 2, tile: tileOf(g.map, 45, 0), ticksLeft: 0, cooldown: 0 });
    g.nations[2].buildingCounts.samLauncher = 1;
    expect(applyCommand(g, { type: 'nuke', nation: 1, tile: tileOf(g.map, 45, 0), kind: 'atom' })).toEqual({ ok: true });
    for (let i = 0; i < 12; i++) g.step();
    expect(g.falloutCount).toBe(0);
    expect(g.drainEvents().some((e) => e.type === 'nukeIntercepted' && e.by === 2)).toBe(true);
  });

  it('one SAM stops one warhead of a volley and the others still detonate', () => {
    const g = makeTestGame({
      map: ['#####'], owners: ['aabbb'], nations: [{ troops: 1000 }, { troops: 3000 }],
    });
    const target = tileOf(g.map, 3, 0);
    g.buildings.add({ id: g.nextId(), type: 'samLauncher', owner: 2, tile: target, ticksLeft: 0, cooldown: 0 });
    for (let i = 0; i < 3; i++) {
      spawnUnit(g, {
        type: 'missile', owner: 1, x: 3, y: 0, path: [target], pathIndex: 1, targetTile: target, speed: 8,
        payload: { kind: 'mirv', radius: 1 },
      });
    }
    g.step();
    const events = g.drainEvents();
    expect(events.filter((e) => e.type === 'nukeIntercepted')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'nuked')).toHaveLength(2);
    expect(g.falloutCount).toBeGreaterThan(0);
  });

  it('decontaminate spends gold to clear fallout on your own tiles', () => {
    const g = makeTestGame({
      map: ['#####'], owners: ['aaaaa'], nations: [{ gold: CONFIG.nukes.cleanCost * 2 + 10 }],
    });
    markFallout(g, 0);
    markFallout(g, 1);
    markFallout(g, 4);
    expect(applyCommand(g, { type: 'clean', nation: 1, tile: 0 })).toEqual({ ok: true });
    expect(g.fallout[0]).toBe(0);
    expect(g.fallout[1]).toBe(0);
    // tile 4 is outside the clean radius, and the gold ran out after two tiles anyway
    expect(g.fallout[4]).toBe(1);
    expect(g.nations[1].gold).toBe(10);
    expect(g.nations[1].falloutTiles).toBe(1);
  });
});

describe('tribes', () => {
  it('scatters named tribes onto small patches the player can farm', () => {
    const g = new Game({
      map: mapFromAscii(plains(100, 40)), seed: 4, player: { name: 'You' }, bots: [], tribes: 3,
    });
    placeTribes(g);
    const tribes = g.nations.filter((n) => n.role === 'tribe');
    expect(tribes).toHaveLength(3);
    for (const tribe of tribes) {
      expect(tribe.tiles).toBeGreaterThan(0);
      expect(tribe.troops).toBe(CONFIG.tribes.troops);
      expect(tribe.shield).toBe(false);
      expect(TRIBE_NAMES).toContain(tribe.name);
    }
    const before = tribes[0].tiles;
    g.phase = 'playing';
    g.tick = CONFIG.tribes.thinkTicks;
    stepTribes(g);
    stepAttacks(g);
    expect(tribes[0].tiles).toBeGreaterThan(before);
  });
});

describe('the box and team mode', () => {
  it('the box is solid land, with mountains, and depends only on the seed', () => {
    const a = generateBoxMap(7, 'small');
    const b = generateBoxMap(7, 'small');
    expect(a.landCount).toBe(a.width * a.height);
    expect(a.terrain.includes(0)).toBe(false);
    expect(a.terrain.includes(3)).toBe(true);
    expect(a.terrain).toEqual(b.terrain);
    expect(generateBoxMap(8, 'small').terrain).not.toEqual(a.terrain);
  });

  it('humans vs nations allies every bot and leaves the player out', () => {
    const g = new Game({
      map: mapFromAscii(plains(30, 10)), seed: 2, player: { name: 'You' },
      bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }], teamMode: true, spawnTicks: 1,
    });
    g.step();
    expect(g.relations.get(2, 3)).toBe('allied');
    expect(g.relations.get(1, 2)).not.toBe('allied');
  });
});

describe('country names', () => {
  it('names world-map bots from the 88 countries', () => {
    expect(COUNTRIES).toHaveLength(88);
    const g = new Game({
      map: mapFromAscii(['####']), seed: 9, player: { name: 'You' },
      bots: [{ difficulty: 'easy' }, { difficulty: 'easy' }, { difficulty: 'easy' }],
      botNames: 'countries',
    });
    const names = g.nations.slice(2).map((n) => n.name);
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(COUNTRIES).toContain(name);
  });
});
