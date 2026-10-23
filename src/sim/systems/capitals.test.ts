import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import { DEFAULT_RULES } from '../../shared/rules';
import type { MatchRules } from '../../shared/rules';
import { ALL_BUILDING_TYPES } from '../../shared/types';
import type { BuildingType, Command, GameEvent, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { generateRandomMap } from '../map/randomMap';
import { Match } from '../match';
import { mapFromAscii } from '../testing/asciiMap';
import { makeTestGame } from '../testing/fixtures';
import { startAttack, stepAttacks } from './attacks';
import { canPlace } from './buildings';
import { capitalOf, placeCapital } from './capitals';
import { defenseMultiplier } from './combat';
import { endSpawnPhase, spawnNation } from './spawn';
import { spawnUnit, stepUnits } from './units';

const CAPITALS: Partial<MatchRules> = { capitals: true };

const plains = (width: number, height: number): string[] => Array.from({ length: height }, () => '#'.repeat(width));

/** A game in the spawn phase on `rows` with `bots` bot nations and no player. */
const spawnGame = (rows: string[], bots: number, capitals: boolean): Game => new Game({
  map: mapFromAscii(rows), seed: 1, player: null,
  bots: Array.from({ length: bots }, () => ({ difficulty: 'normal' as const })),
  rules: { ...DEFAULT_RULES, capitals },
});

/** Puts a building of `type` for `owner` on `tile`, counted when finished. */
function place(g: Game, owner: NationId, type: BuildingType, tile: TileIndex, ticksLeft = 0): number {
  const id = g.nextId();
  g.buildings.add({ id, type, owner, tile, ticksLeft, cooldown: 0 });
  if (ticksLeft === 0) g.nations[owner].buildingCounts[type]++;
  return id;
}

const ofType = <T extends GameEvent['type']>(events: GameEvent[], ...types: T[]) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => (types as string[]).includes(e.type));

/** 60×9 plains: a holds the west half, b the east. */
const front = (rules: Partial<MatchRules> = CAPITALS): Game => makeTestGame({
  map: plains(60, 9), owners: Array.from({ length: 9 }, () => 'a'.repeat(30) + 'b'.repeat(30)),
  nations: [{ troops: 10_000, gold: 100_000 }, { troops: 9_000, gold: 100_000 }], rules,
});

describe('capitals', () => {
  it('with capitals on, a spawn places the capital and moving the spawn moves it', () => {
    const g = spawnGame(plains(40, 20), 2, true);
    const first = tileOf(g.map, 8, 8);
    expect(spawnNation(g, g.nations[1], first)).toEqual({ ok: true });
    expect(capitalOf(g, 1)).toMatchObject({ type: 'capital', owner: 1, tile: first, ticksLeft: 0 });
    expect(g.nations[1].buildingCounts.capital).toBe(1);
    g.drainEvents();

    const moved = tileOf(g.map, 30, 10);
    expect(spawnNation(g, g.nations[1], moved)).toEqual({ ok: true });
    expect(capitalOf(g, 1)).toMatchObject({ type: 'capital', owner: 1, tile: moved, ticksLeft: 0 });
    expect(g.buildings.at(first)).toBeUndefined();
    expect(g.buildings.byId.size).toBe(1);
    expect(g.nations[1].buildingCounts.capital).toBe(1);
    // the old capital goes quietly: no building news
    expect(g.drainEvents().map((e) => e.type)).toEqual(['spawned']);

    // a move within the old disk keeps exactly one capital too
    const nudged = tileOf(g.map, 31, 10);
    expect(spawnNation(g, g.nations[1], nudged)).toEqual({ ok: true });
    expect(capitalOf(g, 1)?.tile).toBe(nudged);
    expect(g.buildings.byId.size).toBe(1);
    expect(g.nations[1].buildingCounts.capital).toBe(1);
    expect(g.drainEvents().map((e) => e.type)).toEqual(['spawned']);
  });

  it('random starts at the end of the spawn phase get a capital too; without capitals there is none', () => {
    for (const capitals of [true, false]) {
      const g = spawnGame(plains(60, 30), 3, capitals);
      expect(spawnNation(g, g.nations[1], tileOf(g.map, 5, 5))).toEqual({ ok: true });
      endSpawnPhase(g);
      for (const id of [1, 2, 3]) {
        const n = g.nations[id];
        expect(n.spawned).toBe(true);
        if (capitals) {
          expect(capitalOf(g, id)).toMatchObject({ owner: id, tile: n.spawnTile, ticksLeft: 0 });
          expect(n.buildingCounts.capital).toBe(1);
        } else {
          expect(capitalOf(g, id)).toBeUndefined();
          expect(n.buildingCounts.capital).toBe(0);
        }
      }
      expect(g.buildings.byId.size).toBe(capitals ? 3 : 0);
    }
  });

  it('the capital defends like a fortress: 2.5 within 25 tiles, 1 beyond', () => {
    expect(CONFIG.buildings.capital).toMatchObject({ radius: 25, multiplier: 2.5 });
    const g = makeTestGame({
      map: plains(60, 3), owners: Array.from({ length: 3 }, () => 'a'.repeat(60)), nations: [{}], rules: CAPITALS,
    });
    placeCapital(g, 1, tileOf(g.map, 0, 1));
    expect(defenseMultiplier(g, tileOf(g.map, 25, 1))).toBe(2.5);
    expect(defenseMultiplier(g, tileOf(g.map, 26, 1))).toBe(1);
  });

  it("capitals can't be built (not buildable), and bombs leave them standing", () => {
    const g = front();
    const mine = tileOf(g.map, 10, 4);
    expect(canPlace(g, 1, 'capital', mine)).toEqual({ ok: false, reason: 'not buildable' });
    // before any other check
    expect(canPlace(g, 1, 'capital', -1)).toEqual({ ok: false, reason: 'not buildable' });
    expect(canPlace(g, 1, 'capital', tileOf(g.map, 50, 4))).toEqual({ ok: false, reason: 'not buildable' });
    expect(applyCommand(g, { type: 'build', nation: 1, building: 'capital', tile: mine }))
      .toEqual({ ok: false, reason: 'not buildable' });
    expect(g.buildings.byId.size).toBe(0);
    expect(g.nations[1].gold).toBe(100_000);

    place(g, 1, 'airport', tileOf(g.map, 5, 4));
    const capital = tileOf(g.map, 46, 4);
    placeCapital(g, 2, capital);
    const city = tileOf(g.map, 48, 4);
    place(g, 2, 'city', city);
    expect(applyCommand(g, { type: 'bomb', nation: 1, tile: capital })).toEqual({ ok: true });
    const events: GameEvent[] = [];
    for (let i = 0; i < 40; i++) {
      stepUnits(g);
      events.push(...g.drainEvents());
    }
    expect(ofType(events, 'bombed')).toHaveLength(1);
    expect(g.buildings.at(city)).toBeUndefined();
    expect(capitalOf(g, 2)?.tile).toBe(capital);
    expect(g.nations[2].buildingCounts.capital).toBe(1);
  });

  it('paratroopers and boat landings within 3 tiles of an enemy capital are refused: too close to a capital; 4 tiles away is fine', () => {
    const reject = (g: Game, cmd: Command): void => {
      const { gold, troops } = g.nations[1];
      const reason = 'too close to a capital';
      expect(applyCommand(g, cmd)).toEqual({ ok: false, reason });
      expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: 1, reason }]);
      expect([g.nations[1].gold, g.nations[1].troops]).toEqual([gold, troops]);
      expect(g.units.size).toBe(0);
    };

    const air = front();
    place(air, 1, 'airport', tileOf(air.map, 5, 4));
    placeCapital(air, 2, tileOf(air.map, 46, 4));
    // a 7×7 square around the capital
    for (const [x, y] of [[43, 4], [49, 4], [46, 1], [46, 7], [43, 1], [49, 7], [46, 4]]) {
      reject(air, { type: 'paradrop', nation: 1, tile: tileOf(air.map, x, y), ratio: 0.2 });
    }
    const clear = tileOf(air.map, 42, 4);
    expect(applyCommand(air, { type: 'paradrop', nation: 1, tile: clear, ratio: 0.2 })).toEqual({ ok: true });

    const sea = (capitalX: number): Game => {
      const g = makeTestGame({
        map: Array.from({ length: 3 }, () => '###......########'),
        owners: Array.from({ length: 3 }, () => 'aaa......bbbbbbbb'),
        nations: [{ troops: 1000 }, { troops: 100 }], rules: CAPITALS,
      });
      placeCapital(g, 2, tileOf(g.map, capitalX, 1));
      return g;
    };
    const beach = (g: Game): TileIndex => tileOf(g.map, 9, 1);
    const near = sea(12);
    reject(near, { type: 'boat', nation: 1, tile: beach(near), ratio: 0.5 });
    // an attack over the water finds the same beach
    reject(near, { type: 'attack', nation: 1, tile: tileOf(near.map, 14, 1), ratio: 0.5, allowBoat: true });
    const far = sea(13);
    expect(applyCommand(far, { type: 'boat', nation: 1, tile: beach(far), ratio: 0.5 })).toEqual({ ok: true });
  });

  it('taking the capital knocks the owner out: all its land and buildings go to the capturer', () => {
    // b's capital at (5, 1) is the only tile of b's that a touches; unowned land lies east of b
    const g = makeTestGame({
      map: ['#####.#########', '###############', '#####.#########'],
      owners: ['aaaaa.bbbbbb...', 'aaaaabbbbbbb...', 'aaaaa.bbbbbb...'],
      nations: [{ troops: 100_000 }, { troops: 1000, gold: 7000 }], rules: CAPITALS,
    });
    const capital = tileOf(g.map, 5, 1);
    placeCapital(g, 1, tileOf(g.map, 1, 1));
    placeCapital(g, 2, capital);
    const city = place(g, 2, 'city', tileOf(g.map, 9, 1));
    const fort = place(g, 2, 'defensePost', tileOf(g.map, 7, 0));
    const factory = place(g, 2, 'factory', tileOf(g.map, 11, 2), 20);
    place(g, 1, 'city', tileOf(g.map, 2, 0));
    spawnUnit(g, { type: 'warship', owner: 2, x: 5, y: 0 });
    const former: TileIndex[] = [];
    for (let t = 0; t < g.owner.length; t++) if (g.owner[t] === 2) former.push(t);
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: capital, ratio: 0.5 })).toEqual({ ok: true });
    // b's own attack, on the free land, comes second, so it is dropped before it moves
    expect(startAttack(g, 2, 0, 100)).toEqual({ ok: true });
    g.drainEvents();

    stepAttacks(g);
    const events = g.drainEvents();
    expect(ofType(events, 'capitalFell', 'eliminated', 'buildingCaptured', 'buildingDestroyed')).toEqual([
      { type: 'capitalFell', nation: 2, by: 1, tiles: former.length - 1 },
      { type: 'eliminated', nation: 2, by: 1, capital: true },
    ]);
    for (const t of former) expect(g.owner[t]).toBe(1);
    const a = g.nations[1];
    const b = g.nations[2];
    expect([b.alive, b.tiles, b.troops, b.gold]).toEqual([false, 0, 0, 0]);
    expect(a.tiles).toBe(15 + former.length);
    for (const id of [city, fort, factory]) expect(g.buildings.byId.get(id)?.owner).toBe(1);
    expect(g.buildings.ofNation(2)).toEqual([]);
    expect(a.buildingCounts).toMatchObject({ city: 2, defensePost: 1, factory: 0, capital: 1 });
    expect(Object.values(b.buildingCounts).every((c) => c === 0)).toBe(true);
    expect(g.buildings.at(capital)).toBeUndefined();
    expect(capitalOf(g, 1)?.tile).toBe(tileOf(g.map, 1, 1));
    expect([...g.units.values()].filter((u) => u.owner === 2)).toEqual([]);
    expect(g.attacks.filter((at) => at.attacker === 2 || at.target === 2)).toEqual([]);
  });

  it('nobody is knocked out twice when the capital is their last tile', () => {
    const g = makeTestGame({
      map: ['#####'], owners: ['aaaab'], nations: [{ troops: 100_000 }, { troops: 10 }], rules: CAPITALS,
    });
    placeCapital(g, 2, tileOf(g.map, 4, 0));
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: tileOf(g.map, 4, 0), ratio: 0.5 })).toEqual({ ok: true });
    stepAttacks(g);
    stepAttacks(g);
    expect(ofType(g.drainEvents(), 'capitalFell', 'eliminated')).toEqual([
      { type: 'capitalFell', nation: 2, by: 1, tiles: 0 },
      { type: 'eliminated', nation: 2, by: 1, capital: true },
    ]);
    expect(g.nations[2].alive).toBe(false);
    expect(g.owner[tileOf(g.map, 4, 0)]).toBe(1);
  });

  it('an enemy taking a tile within 25 of a capital warns its owner, at most once every 300 ticks', () => {
    const strip = (capitals: boolean): Game => {
      const g = makeTestGame({
        map: plains(80, 3), owners: Array.from({ length: 3 }, () => 'a'.repeat(20) + 'b'.repeat(60)),
        nations: [{}, {}], rules: { capitals },
      });
      placeCapital(g, 2, tileOf(g.map, 50, 1));
      return g;
    };
    const g = strip(true);
    const threats = (): GameEvent[] => ofType(g.drainEvents(), 'capitalThreat');
    const warning = { type: 'capitalThreat', nation: 2, tile: tileOf(g.map, 50, 1) };
    // 26 tiles away: no warning
    g.setOwner(tileOf(g.map, 24, 1), 1);
    expect(threats()).toEqual([]);
    g.setOwner(tileOf(g.map, 25, 1), 1);
    expect(threats()).toEqual([warning]);
    g.setOwner(tileOf(g.map, 26, 1), 1);
    g.tick += CONFIG.capitals.threatCooldownTicks - 1;
    g.setOwner(tileOf(g.map, 27, 1), 1);
    expect(threats()).toEqual([]);
    g.tick += 1;
    g.setOwner(tileOf(g.map, 28, 1), 1);
    expect(threats()).toEqual([warning]);
    // losing land to nobody, or the owner gaining land, is no threat
    g.tick += CONFIG.capitals.threatCooldownTicks;
    g.setOwner(tileOf(g.map, 30, 1), 0);
    g.setOwner(tileOf(g.map, 19, 1), 2);
    expect(threats()).toEqual([]);

    // without capitals there is no warning at all
    const off = strip(false);
    off.setOwner(tileOf(off.map, 30, 1), 1);
    expect(ofType(off.drainEvents(), 'capitalThreat')).toEqual([]);
  });

  it('with capitals on, an aimed attack reaches its aim sooner than the same attack unaimed', () => {
    const ticksToTake = (capitals: boolean): number => {
      const g = makeTestGame({
        map: plains(60, 40), owners: Array.from({ length: 40 }, () => 'aa' + 'b'.repeat(58)),
        nations: [{ troops: 1e7 }, { troops: 0 }], rules: { capitals },
      });
      const aim = tileOf(g.map, 59, 0);
      expect(applyCommand(g, { type: 'attack', nation: 1, tile: aim, ratio: 1 })).toEqual({ ok: true });
      expect(g.attacks[0].aim).toBe(capitals ? aim : null);
      for (let tick = 1; tick <= 2000; tick++) {
        stepAttacks(g);
        if (g.owner[aim] === 1) return tick;
      }
      return Infinity;
    };
    const unaimed = ticksToTake(false);
    const aimed = ticksToTake(true);
    expect(unaimed).toBeLessThan(Infinity);
    expect(aimed).toBeLessThan(unaimed);
  });

  it('a random capitals match keeps its books', () => {
    const m = new Match({
      map: generateRandomMap(7, 'small'),
      seed: 7,
      player: null,
      bots: Array.from({ length: 8 }, () => ({ difficulty: 'hard' as const })),
      spawnTicks: 1,
      checkVictory: false,
      rules: { ...DEFAULT_RULES, capitals: true },
    });
    const { game } = m;
    const eliminated = new Map<NationId, number>();
    let falls = 0;
    for (let i = 0; i < 1500; i++) {
      m.step();
      for (const e of game.drainEvents()) {
        if (e.type === 'eliminated') eliminated.set(e.nation, (eliminated.get(e.nation) ?? 0) + 1);
        if (e.type === 'capitalFell') falls++;
      }
    }
    // the books are checked after capitals have fallen
    expect(falls).toBeGreaterThan(0);
    const owned = new Map<NationId, number>();
    for (const o of game.owner) owned.set(o, (owned.get(o) ?? 0) + 1);
    for (const n of game.nations.slice(1)) {
      expect(n.tiles).toBe(owned.get(n.id) ?? 0);
      const finished = game.buildings.ofNation(n.id).filter((b) => b.ticksLeft === 0);
      for (const type of ALL_BUILDING_TYPES) {
        expect(n.buildingCounts[type]).toBe(finished.filter((b) => b.type === type).length);
      }
      expect(eliminated.get(n.id) ?? 0).toBeLessThanOrEqual(1);
      const capitals = game.buildings.ofNation(n.id, 'capital');
      expect(capitals.length).toBeLessThanOrEqual(1);
      if (!n.alive) expect(capitals).toEqual([]);
    }
  });
});
