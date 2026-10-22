import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { BuildingType, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { startAttack, stepAttacks } from './attacks';
import {
  BuildingStore, buildingCost, buildingsInRadius, canPlace, destroyBuilding, stepBuildings,
} from './buildings';
import type { Building } from './buildings';
import { defenseMultiplier, density, tileCaptureCost } from './combat';
import { goldIncome, maxTroops, tradeMultiplier, troopGrowth } from './economy';

const B = CONFIG.buildings;
const { baseCost, densityFactor } = CONFIG.combat;
/** Enough gold for any number of buildings. */
const RICH = 1e9;

/** `height` rows of `width` characters, each one `cell(x, y)`. */
const rows = (width: number, height: number, cell: (x: number, y: number) => string): string[] =>
  Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => cell(x, y)).join(''));

const place = (g: Game, nation: NationId, building: BuildingType, tile: TileIndex): CommandResult =>
  applyCommand(g, { type: 'build', nation, building, tile });

/** Issues a build command that must be accepted, and returns the new building. */
function placed(g: Game, nation: NationId, building: BuildingType, tile: TileIndex): Building {
  expect(place(g, nation, building, tile)).toEqual({ ok: true });
  const b = g.buildings.at(tile);
  if (!b) throw new Error(`no building at ${tile}`);
  return b;
}

/** Runs the building countdown alone (no economy, no attacks) for `ticks` ticks. */
function runBuildings(g: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepBuildings(g);
}

/** Advances only the attacks until none is left. */
function runAttacks(g: Game): void {
  for (let i = 0; i < 1000 && g.attacks.length > 0; i++) stepAttacks(g);
  expect(g.attacks).toEqual([]);
}

/**
 * A 10×6 island: a holds columns 1–5, b columns 6–7, and column 8 is unowned land. The inland (non-coastal) tiles are
 * columns 2–7 of rows 2 and 3.
 */
const SHORE = {
  map: [
    '..........',
    '.########.',
    '.########.',
    '.########.',
    '.########.',
    '..........',
  ],
  owners: [
    '..........',
    '.aaaaabb..',
    '.aaaaabb..',
    '.aaaaabb..',
    '.aaaaabb..',
    '..........',
  ],
};

describe('BuildingStore', () => {
  const make = (id: number, type: BuildingType, owner: NationId, tile: TileIndex): Building =>
    ({ id, type, owner, tile, ticksLeft: 0, cooldown: 0 });

  it('indexes buildings by id, tile and owner, and keeps each owner\'s list in id order', () => {
    const store = new BuildingStore();
    const b1 = make(1, 'city', 1, 10);
    const b2 = make(2, 'factory', 2, 20);
    const b3 = make(3, 'city', 2, 30);
    const b4 = make(4, 'factory', 1, 40);
    for (const b of [b1, b2, b3, b4]) store.add(b);

    expect(store.byId.get(2)).toBe(b2);
    expect(store.at(30)).toBe(b3);
    expect(store.at(31)).toBeUndefined();
    expect(store.ofNation(1)).toEqual([b1, b4]);
    expect(store.ofNation(2, 'city')).toEqual([b3]);
    expect(store.ofNation(2, 'bank')).toEqual([]);
    expect(store.ofNation(3)).toEqual([]);

    // b1 joins nation 2 ahead of its later-built city and factory
    store.transfer(1, 2);
    expect(b1.owner).toBe(2);
    expect(store.ofNation(1)).toEqual([b4]);
    expect(store.ofNation(2)).toEqual([b1, b2, b3]);
    expect(store.ofNation(2, 'city')).toEqual([b1, b3]);
    expect(store.at(10)).toBe(b1);

    store.remove(3);
    expect(store.byId.has(3)).toBe(false);
    expect(store.at(30)).toBeUndefined();
    expect(store.ofNation(2, 'city')).toEqual([b1]);
    store.remove(3);
    expect(store.byId.size).toBe(3);
  });

  it('hands out copies, so callers cannot disturb the index', () => {
    const store = new BuildingStore();
    store.add(make(1, 'city', 1, 10));
    store.ofNation(1).pop();
    store.ofNation(1, 'city').pop();
    expect(store.ofNation(1, 'city')).toHaveLength(1);
  });

  it('refuses a second building on a tile and a reused id', () => {
    const store = new BuildingStore();
    store.add(make(1, 'city', 1, 10));
    expect(() => store.add(make(2, 'bank', 1, 10))).toThrow();
    expect(() => store.add(make(1, 'bank', 1, 11))).toThrow();
    expect(store.byId.size).toBe(1);
  });
});

describe('buildingCost', () => {
  it('cost rises with each building of a type', () => {
    const step = B.minSpacing + 1;
    const g = makeTestGame({ map: ['#'.repeat(3 * step)], owners: ['a'.repeat(3 * step)], nations: [{}, {}] });
    const a = g.nations[1];
    expect(buildingCost(g, 1, 'city')).toBe(B.city.cost);
    // each city pays exactly the current price, which rises with the cities already standing or under construction
    for (let i = 0; i < 3; i++) {
      const cost = buildingCost(g, 1, 'city');
      expect(cost).toBe(B.city.cost * (1 + B.costGrowth * i));
      a.gold = cost;
      expect(place(g, 1, 'city', i * step)).toEqual({ ok: true });
      expect(a.gold).toBe(0);
    }
    expect(buildingCost(g, 1, 'city')).toBe(B.city.cost * (1 + 3 * B.costGrowth));
    // other types and other nations keep the base price
    expect(buildingCost(g, 1, 'factory')).toBe(B.factory.cost);
    expect(buildingCost(g, 2, 'city')).toBe(B.city.cost);
    // finishing construction changes nothing
    runBuildings(g, B.city.buildTicks);
    expect(a.buildingCounts.city).toBe(3);
    expect(buildingCost(g, 1, 'city')).toBe(B.city.cost * (1 + 3 * B.costGrowth));
  });
});

describe('placement', () => {
  it('rejects foreign, water, too-close, inland-port and unaffordable placements with distinct reasons', () => {
    // a can't quite afford a city; b's city stands next to a's land
    const g = makeTestGame({ ...SHORE, nations: [{ gold: B.city.cost - 1 }, { gold: RICH }] });
    const neighbour = placed(g, 2, 'city', tileOf(g.map, 6, 2));
    g.drainEvents();
    const at = (x: number, y: number): TileIndex => tileOf(g.map, x, y);
    const cases: [BuildingType, TileIndex, string][] = [
      ['city', -1, 'off the map'],
      ['city', g.map.width * g.map.height, 'off the map'],
      ['city', 2.5, 'off the map'],
      ['city', at(0, 2), 'not land'],
      ['city', at(7, 3), 'not your land'], // b's land
      ['city', at(8, 3), 'not your land'], // unowned land
      ['port', at(3, 2), 'needs coast'],
      ['navalBase', at(2, 3), 'needs coast'],
      ['city', at(5, 2), 'too close to another building'],
      ['city', at(1, 4), 'not enough gold'],
    ];
    const reasons = new Set<string>();
    for (const [building, tile, reason] of cases) {
      const result = place(g, 1, building, tile);
      expect(result).toEqual({ ok: false, reason });
      // exactly one rejected event, naming a and the reason
      expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: 1, reason }]);
      if (!result.ok) reasons.add(result.reason);
    }
    expect(reasons.size).toBe(6);
    // nothing changed
    expect(g.nations[1].gold).toBe(B.city.cost - 1);
    expect([...g.buildings.byId.values()]).toEqual([neighbour]);
    expect(g.drainChangedTiles()).toEqual([]);
  });

  it('checks land, ownership, coast, spacing and gold in that order', () => {
    // a is broke; b's city stands next to a's inland tile (5, 2)
    const g = makeTestGame({ ...SHORE, nations: [{ gold: 0 }, { gold: RICH }] });
    placed(g, 2, 'city', tileOf(g.map, 6, 2));
    const at = (x: number, y: number): TileIndex => tileOf(g.map, x, y);
    expect(canPlace(g, 1, 'port', at(0, 0))).toEqual({ ok: false, reason: 'not land' });
    expect(canPlace(g, 1, 'port', at(7, 2))).toEqual({ ok: false, reason: 'not your land' });
    expect(canPlace(g, 1, 'port', at(5, 2))).toEqual({ ok: false, reason: 'needs coast' });
    expect(canPlace(g, 1, 'city', at(5, 2))).toEqual({ ok: false, reason: 'too close to another building' });
    expect(canPlace(g, 1, 'city', at(1, 4))).toEqual({ ok: false, reason: 'not enough gold' });
    g.nations[1].gold = B.port.cost;
    expect(canPlace(g, 1, 'port', at(1, 4))).toEqual({ ok: true });
    expect(canPlace(g, 1, 'navalBase', at(1, 4))).toEqual({ ok: false, reason: 'not enough gold' });
    // canPlace only checks: no events, no changes
    expect(g.drainEvents()).toEqual([]);
    expect(g.nations[1].gold).toBe(B.port.cost);
  });

  it('spaces buildings by Chebyshev distance, whoever owns them and even under construction', () => {
    const s = B.minSpacing;
    const size = s + 2;
    // b's city goes in the corner; a holds every other tile
    const g = makeTestGame({
      map: rows(size, size, () => '#'),
      owners: rows(size, size, (x, y) => (x === 0 && y === 0 ? 'b' : 'a')),
      nations: [{ gold: RICH }, { gold: RICH }],
    });
    placed(g, 2, 'city', 0);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x === 0 && y === 0) continue;
        // (s, s) lies more than s away in a straight line but is still too close
        const expected = Math.max(x, y) > s ? { ok: true } : { ok: false, reason: 'too close to another building' };
        expect(canPlace(g, 1, 'city', tileOf(g.map, x, y))).toEqual(expected);
      }
    }
  });
});

describe('the build command', () => {
  it('pays the cost and starts construction; Game.step counts down before the economy runs', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aaaa'], nations: [{ gold: B.factory.cost }] });
    const n = g.nations[1];
    const id = g.nextId() + 1;
    g.queue({ type: 'build', nation: 1, building: 'factory', tile: 2 });
    g.step();
    // the command applied first, then this tick's countdown ran
    expect(g.buildings.ofNation(1)).toEqual([
      { id, type: 'factory', owner: 1, tile: 2, ticksLeft: B.factory.buildTicks - 1, cooldown: 0 },
    ]);
    const landIncome = CONFIG.gold.base + 4 * CONFIG.gold.perTile;
    // paid in full, then earned one tick of land income
    expect(n.gold).toBeCloseTo(landIncome, 10);
    expect(g.drainEvents()).toEqual([]);

    for (let i = 1; i < B.factory.buildTicks - 1; i++) g.step();
    expect(g.buildings.at(2)?.ticksLeft).toBe(1);
    const before = n.gold;
    g.step();
    // the factory finished this tick and this tick's economy already paid it
    expect(n.gold).toBeCloseTo(before + landIncome + B.factory.gold, 10);
    expect(g.drainEvents()).toEqual([{ type: 'buildingDone', nation: 1, building: 'factory', tile: 2 }]);
  });
});

describe('construction and effects', () => {
  it('activates after buildTicks and applies city, factory, barracks and bank effects', () => {
    const types: BuildingType[] = ['city', 'city', 'factory', 'barracks', 'bank'];
    const step = B.minSpacing + 1;
    const width = types.length * step;
    const g = makeTestGame({ map: ['#'.repeat(width)], owners: ['a'.repeat(width)], nations: [{ gold: RICH, troops: 1000 }] });
    const n = g.nations[1];
    const base = { max: maxTroops(g, n), gold: goldIncome(g, n) };
    expect(tradeMultiplier(g, n)).toBe(1);
    const buildings = types.map((type, i) => placed(g, 1, type, i * step));
    g.drainEvents();

    const { baseGrowth, growthRate, overMaxDecay } = CONFIG.troops;
    const lastTick = Math.max(...types.map((type) => B[type].buildTicks));
    for (let tick = 1; tick <= lastTick + 1; tick++) {
      stepBuildings(g);
      const done = buildings.filter((b) => B[b.type].buildTicks <= tick);
      const active = (type: BuildingType): number => done.filter((b) => b.type === type).length;
      expect(buildings.map((b) => b.ticksLeft)).toEqual(buildings.map((b) => Math.max(0, B[b.type].buildTicks - tick)));
      // the buildings finishing this tick, in id order
      expect(g.drainEvents()).toEqual(buildings
        .filter((b) => B[b.type].buildTicks === tick)
        .map((b) => ({ type: 'buildingDone', nation: 1, building: b.type, tile: b.tile })));
      expect(n.stats.buildingsBuilt).toBe(done.length);
      for (const type of ['city', 'factory', 'barracks', 'bank'] as const) expect(n.buildingCounts[type]).toBe(active(type));

      // only active buildings have an effect
      const max = base.max + B.city.maxTroops * active('city');
      expect(maxTroops(g, n)).toBe(max);
      const growth = (baseGrowth + growthRate * n.troops * (1 - n.troops / max)) * (1 + B.barracks.growthBonus * active('barracks'));
      expect(troopGrowth(g, n)).toBeCloseTo(growth, 10);
      expect(goldIncome(g, n)).toBeCloseTo(base.gold + B.factory.gold * active('factory') + B.bank.gold * active('bank'), 10);
      expect(tradeMultiplier(g, n)).toBeCloseTo(1 + B.bank.tradeBonus * active('bank'), 10);
    }
    expect(n.buildingCounts).toMatchObject({ city: 2, factory: 1, barracks: 1, bank: 1 });
    expect(maxTroops(g, n)).toBe(base.max + 2 * B.city.maxTroops);

    // barracks speed up growth but not the decay above max
    const max = maxTroops(g, n);
    n.troops = max + 1000;
    expect(troopGrowth(g, n)).toBeCloseTo(-overMaxDecay * 1000, 10);
  });
});

describe('defense buildings', () => {
  it('defense post raises capture cost inside its radius only', () => {
    const r = B.defensePost.radius;
    const size = r + 3;
    // b's post stands at (1, 1). b holds every tile but a's corner (0, 0) and the unowned tile (1, 0).
    const g = makeTestGame({
      map: rows(size, size, () => '#'),
      owners: rows(size, size, (x, y) => (y > 0 ? 'b' : x === 0 ? 'a' : x === 1 ? '.' : 'b')),
      nations: [{ troops: 100 }, { troops: 5000, gold: RICH }],
    });
    const post = tileOf(g.map, 1, 1);
    placed(g, 2, 'defensePost', post);
    const tileCount = size * size;

    // under construction it protects nothing
    runBuildings(g, B.defensePost.buildTicks - 1);
    for (let t = 0; t < tileCount; t++) expect(defenseMultiplier(g, t)).toBe(1);

    stepBuildings(g);
    for (let t = 0; t < tileCount; t++) {
      const dx = (t % size) - 1;
      const dy = Math.floor(t / size) - 1;
      const covered = g.owner[t] === 2 && dx * dx + dy * dy <= r * r;
      expect(defenseMultiplier(g, t)).toBe(covered ? B.defensePost.multiplier : 1);
    }

    const plain = baseCost + density(g.nations[2]) * densityFactor;
    // exactly r away counts; one more tile does not
    expect(tileCaptureCost(g, 1, tileOf(g.map, 1 + r, 1))).toBeCloseTo(plain * B.defensePost.multiplier, 10);
    expect(tileCaptureCost(g, 1, tileOf(g.map, 2 + r, 1))).toBeCloseTo(plain, 10);
    // a diagonal tile inside the square but outside the circle is not covered: the radius is Euclidean
    const d = Math.ceil(r / Math.SQRT2);
    expect(tileCaptureCost(g, 1, tileOf(g.map, 1 + d, 1 + d))).toBeCloseTo(plain, 10);
    // the post guards only its owner's land
    expect(defenseMultiplier(g, tileOf(g.map, 0, 0))).toBe(1);
    expect(defenseMultiplier(g, tileOf(g.map, 1, 0))).toBe(1);

    // a second post, out of the first one's reach, guards nothing until it is finished, though the first is active
    const second = tileOf(g.map, size - 1, size - 1);
    placed(g, 2, 'defensePost', second);
    expect(defenseMultiplier(g, second)).toBe(1);
    runBuildings(g, B.defensePost.buildTicks);
    expect(defenseMultiplier(g, second)).toBe(B.defensePost.multiplier);
  });

  it('fortress and post covering the same tile use the max, not the product', () => {
    const rf = B.fortress.radius;
    const rp = B.defensePost.radius;
    const width = rf + rp + 2;
    // b's fortress stands at 0 and its post at rf, so tiles rf − rp … rf are covered by both
    const g = makeTestGame({ map: ['#'.repeat(width)], owners: ['b'.repeat(width)], nations: [{}, { troops: 5000, gold: RICH }] });
    placed(g, 2, 'fortress', 0);
    placed(g, 2, 'defensePost', rf);
    runBuildings(g, Math.max(B.fortress.buildTicks, B.defensePost.buildTicks));

    const strongest = Math.max(B.fortress.multiplier, B.defensePost.multiplier);
    expect(defenseMultiplier(g, rf)).toBe(strongest);
    expect(defenseMultiplier(g, rf)).not.toBeCloseTo(B.fortress.multiplier * B.defensePost.multiplier, 5);
    expect(defenseMultiplier(g, 0)).toBe(B.fortress.multiplier);
    expect(defenseMultiplier(g, rf + rp)).toBe(B.defensePost.multiplier);
    expect(defenseMultiplier(g, rf + rp + 1)).toBe(1);
    for (let x = 0; x < width; x++) {
      const covering = [1];
      if (x <= rf) covering.push(B.fortress.multiplier);
      if (Math.abs(x - rf) <= rp) covering.push(B.defensePost.multiplier);
      expect(defenseMultiplier(g, x)).toBe(Math.max(...covering));
    }
    const plain = baseCost + density(g.nations[2]) * densityFactor;
    expect(tileCaptureCost(g, 1, rf - rp)).toBeCloseTo(plain * strongest, 10);
  });
});

describe('capture and destruction', () => {
  it('captured buildings change owner and counts', () => {
    const step = B.minSpacing + 1;
    // a holds [0, 2·step) with an unfinished factory at 0 and an active city at step; b holds [2·step, 3·step) with an
    // active city at 2·step. a has no troops, so b's attack takes everything.
    const g = makeTestGame({
      map: ['#'.repeat(3 * step)],
      owners: ['a'.repeat(2 * step) + 'b'.repeat(step)],
      nations: [{ gold: RICH }, { gold: RICH, troops: 1e6 }],
    });
    const [a, b] = [g.nations[1], g.nations[2]];
    const aCity = placed(g, 1, 'city', step);
    const bCity = placed(g, 2, 'city', 2 * step);
    runBuildings(g, B.city.buildTicks);
    const factory = placed(g, 1, 'factory', 0);
    expect(a.buildingCounts.city).toBe(1);
    expect(maxTroops(g, b)).toBe(CONFIG.troops.baseMax + step * CONFIG.troops.perTile + B.city.maxTroops);
    const aBuilt = a.stats.buildingsBuilt;
    const bBuilt = b.stats.buildingsBuilt;
    g.drainEvents();

    expect(startAttack(g, 2, 1, 1e5)).toEqual({ ok: true });
    runAttacks(g);
    expect(a.alive).toBe(false);
    expect(g.drainEvents().filter((e) => e.type === 'buildingCaptured')).toEqual([
      { type: 'buildingCaptured', from: 1, to: 2, building: 'city', tile: step },
      { type: 'buildingCaptured', from: 1, to: 2, building: 'factory', tile: 0 },
    ]);
    expect([aCity.owner, factory.owner]).toEqual([2, 2]);
    expect(g.buildings.ofNation(1)).toEqual([]);
    expect(g.buildings.ofNation(2)).toEqual([aCity, bCity, factory]);
    expect(g.buildings.ofNation(2, 'city')).toEqual([aCity, bCity]);
    // the active city's count moved with it; the factory isn't counted until it is finished
    expect(a.buildingCounts).toMatchObject({ city: 0, factory: 0 });
    expect(b.buildingCounts).toMatchObject({ city: 2, factory: 0 });
    expect(maxTroops(g, b)).toBe(CONFIG.troops.baseMax + 3 * step * CONFIG.troops.perTile + 2 * B.city.maxTroops);
    expect(buildingCost(g, 2, 'city')).toBe(B.city.cost * (1 + 2 * B.costGrowth));
    expect(buildingCost(g, 2, 'factory')).toBe(B.factory.cost * (1 + B.costGrowth));

    // the captured factory finishes for its new owner
    runBuildings(g, B.factory.buildTicks);
    expect(b.buildingCounts.factory).toBe(1);
    expect(b.stats.buildingsBuilt).toBe(bBuilt + 1);
    expect(a.stats.buildingsBuilt).toBe(aBuilt);
    expect(g.drainEvents()).toEqual([{ type: 'buildingDone', nation: 2, building: 'factory', tile: 0 }]);
  });

  it('a building whose tile becomes unowned is destroyed', () => {
    const step = B.minSpacing + 1;
    const g = makeTestGame({ map: ['#'.repeat(2 * step)], owners: ['a'.repeat(2 * step)], nations: [{ gold: RICH }] });
    const n = g.nations[1];
    placed(g, 1, 'city', 0);
    runBuildings(g, B.city.buildTicks);
    placed(g, 1, 'factory', step);
    g.drainEvents();
    g.setOwner(0, 0);
    g.setOwner(step, 0);
    expect(g.buildings.byId.size).toBe(0);
    expect(g.buildings.at(0)).toBeUndefined();
    expect(n.buildingCounts.city).toBe(0);
    expect(g.drainEvents()).toEqual([
      { type: 'buildingDestroyed', owner: 1, by: 0, building: 'city', tile: 0 },
      { type: 'buildingDestroyed', owner: 1, by: 0, building: 'factory', tile: step },
    ]);
    // a destroyed building no longer counts toward the price
    expect(buildingCost(g, 1, 'city')).toBe(B.city.cost);
  });

  it('destroyBuilding removes the building, uncounts it if active and names who destroyed it', () => {
    const step = B.minSpacing + 1;
    const g = makeTestGame({ map: ['#'.repeat(2 * step)], owners: ['a'.repeat(2 * step)], nations: [{ gold: RICH }, {}] });
    const n = g.nations[1];
    const bank = placed(g, 1, 'bank', 0);
    runBuildings(g, B.bank.buildTicks);
    const city = placed(g, 1, 'city', step);
    g.drainEvents();
    const max = maxTroops(g, n);

    destroyBuilding(g, bank.id, 2);
    expect(n.buildingCounts.bank).toBe(0);
    expect(tradeMultiplier(g, n)).toBe(1);
    // the city was still under construction, so there is no count to take back
    destroyBuilding(g, city.id, 2);
    expect(n.buildingCounts.city).toBe(0);
    expect(maxTroops(g, n)).toBe(max);
    expect(g.buildings.ofNation(1)).toEqual([]);
    expect(g.buildings.at(0)).toBeUndefined();
    expect(g.drainEvents()).toEqual([
      { type: 'buildingDestroyed', owner: 1, by: 2, building: 'bank', tile: 0 },
      { type: 'buildingDestroyed', owner: 1, by: 2, building: 'city', tile: step },
    ]);
    // destroying it again does nothing
    destroyBuilding(g, bank.id, 2);
    expect(g.drainEvents()).toEqual([]);
    expect(n.buildingCounts.bank).toBe(0);
  });
});

describe('buildingsInRadius', () => {
  it('lists the owner\'s buildings of the given types within the radius, in id order, finished or not', () => {
    const step = B.minSpacing + 1;
    const width = 5 * step;
    const g = makeTestGame({
      map: ['#'.repeat(width)],
      owners: ['a'.repeat(4 * step) + 'b'.repeat(step)],
      nations: [{ gold: RICH }, { gold: RICH }],
    });
    const far = placed(g, 1, 'city', 2 * step);
    const city = placed(g, 1, 'city', 0);
    const bank = placed(g, 1, 'bank', 3 * step);
    const theirs = placed(g, 2, 'city', 4 * step);
    runBuildings(g, Math.max(B.city.buildTicks, B.bank.buildTicks));
    const factory = placed(g, 1, 'factory', step);

    // the factory is still under construction and is listed all the same; a building exactly `step` away is inside
    expect(buildingsInRadius(g, 1, ['city', 'factory'], step, step)).toEqual([far, city, factory]);
    expect(buildingsInRadius(g, 1, ['city', 'factory'], step, step - 0.5)).toEqual([factory]);
    expect(buildingsInRadius(g, 1, ['bank'], 0, width)).toEqual([bank]);
    expect(buildingsInRadius(g, 1, ['radar'], 0, width)).toEqual([]);
    expect(buildingsInRadius(g, 2, ['city'], 0, width)).toEqual([theirs]);
  });
});
