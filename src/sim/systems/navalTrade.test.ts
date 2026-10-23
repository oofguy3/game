import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { BuildingType, GameEvent, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { buildWarship, moveWarship } from './naval';
import { spawnUnit, stepUnits } from './units';

/** A long sea between a's coast (left) and b's (right), with c's islet in the middle. */
function sea(): Game {
  const row = (land: string): string => land;
  const map = [
    row('##' + '.'.repeat(76) + '##'),
    row('##' + '.'.repeat(76) + '##'),
    row('##' + '.'.repeat(37) + '##' + '.'.repeat(37) + '##'),
    row('##' + '.'.repeat(76) + '##'),
    row('##' + '.'.repeat(76) + '##'),
  ];
  const owners = map.map((r) => 'aa' + r.slice(2, 39).replace(/[#.]/g, '.') + (r.slice(39, 41) === '##' ? 'cc' : '..') + '.'.repeat(37) + 'bb');
  return makeTestGame({ map, owners, nations: [{ gold: 100_000, troops: 5000 }, { gold: 100_000, troops: 5000 }, { troops: 100 }] });
}

/** Puts a finished building of `type` for `owner` on `tile`. */
function place(g: Game, owner: NationId, type: BuildingType, tile: TileIndex): number {
  const id = g.nextId();
  g.buildings.add({ id, type, owner, tile, ticksLeft: 0, cooldown: 0 });
  g.nations[owner].buildingCounts[type]++;
  return id;
}

const ofType = (g: Game, type: string) => [...g.units.values()].filter((u) => u.type === type);

function run(g: Game, ticks: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    stepUnits(g);
    events.push(...g.drainEvents());
  }
  return events;
}

describe('trade ships', () => {
  it('trade ship pays both sides, with bank bonus', () => {
    const g = sea();
    place(g, 1, 'port', tileOf(g.map, 1, 2));
    place(g, 2, 'port', tileOf(g.map, 78, 2));
    place(g, 1, 'bank', tileOf(g.map, 0, 0));
    const gold1 = g.nations[1].gold;
    const gold2 = g.nations[2].gold;
    const trades = run(g, 200).filter((e): e is Extract<GameEvent, { type: 'trade' }> => e.type === 'trade');
    expect(trades.length).toBeGreaterThanOrEqual(2);
    // each arrival pays the two sides together: a with its bank's bonus
    const [first, second] = trades;
    expect(new Set([first.nation, second.nation])).toEqual(new Set([1, 2]));
    const toA = first.nation === 1 ? first : second;
    const toB = first.nation === 2 ? first : second;
    expect(toA.partner).toBe(2);
    expect(toA.gold / toB.gold).toBeCloseTo(1 + CONFIG.buildings.bank.tradeBonus, 9);
    expect(toB.gold).toBeGreaterThan(CONFIG.units.tradeShip.goldBase);
    const paidA = trades.filter((t) => t.nation === 1).reduce((s, t) => s + t.gold, 0);
    const paidB = trades.filter((t) => t.nation === 2).reduce((s, t) => s + t.gold, 0);
    expect(g.nations[1].gold).toBeCloseTo(gold1 + paidA, 6);
    expect(g.nations[2].gold).toBeCloseTo(gold2 + paidB, 6);
    expect(g.nations[1].tradeIncome).toBeGreaterThan(0);
  });

  it('no trade ships between nations at war or under embargo', () => {
    for (const cut of ['war', 'embargo', 'embargoBack'] as const) {
      const g = sea();
      place(g, 1, 'port', tileOf(g.map, 1, 2));
      place(g, 2, 'port', tileOf(g.map, 78, 2));
      if (cut === 'war') g.relations.set(1, 2, 'war');
      else if (cut === 'embargo') g.relations.setEmbargo(1, 2, true);
      else g.relations.setEmbargo(2, 1, true);
      const events = run(g, 200);
      expect(ofType(g, 'tradeShip')).toEqual([]);
      expect(events.filter((e) => e.type === 'trade')).toEqual([]);
    }
  });

  it('no payout when the destination port was captured mid-trip', () => {
    const g = sea();
    place(g, 1, 'port', tileOf(g.map, 1, 2));
    const dest = tileOf(g.map, 78, 2);
    const bPort = place(g, 2, 'port', dest);
    // b's port sends nothing of its own during the test
    g.buildings.byId.get(bPort)!.cooldown = 1e9;
    // let a's ship set out for b's port, then hand that port to c before it arrives
    run(g, 2);
    expect(ofType(g, 'tradeShip')).toEqual([expect.objectContaining({ owner: 1, partner: 2 })]);
    g.setOwner(dest, 3);
    const gold = [g.nations[1].gold, g.nations[2].gold, g.nations[3].gold];
    const events = run(g, 140);
    expect(ofType(g, 'tradeShip')).toEqual([]);
    expect(events.filter((e) => e.type === 'trade')).toEqual([]);
    expect([g.nations[1].gold, g.nations[2].gold, g.nations[3].gold]).toEqual(gold);
  });
});

describe('warships', () => {
  it('buildWarship builds at an active naval base the nation owns, for gold', () => {
    const g = sea();
    const base = place(g, 1, 'navalBase', tileOf(g.map, 1, 1));
    expect(buildWarship(g, 2, base)).toEqual({ ok: false, reason: 'not your naval base' });
    g.buildings.byId.get(base)!.ticksLeft = 5;
    expect(buildWarship(g, 1, base)).toEqual({ ok: false, reason: 'still being built' });
    g.buildings.byId.get(base)!.ticksLeft = 0;
    g.nations[1].gold = CONFIG.units.warship.cost - 1;
    expect(buildWarship(g, 1, base)).toEqual({ ok: false, reason: 'not enough gold' });
    g.nations[1].gold = CONFIG.units.warship.cost;
    expect(applyCommand(g, { type: 'buildUnit', nation: 1, unit: 'warship', buildingId: base })).toEqual({ ok: true });
    expect(g.nations[1].gold).toBe(0);
    const [ship] = ofType(g, 'warship');
    expect(ship).toMatchObject({ owner: 1, hp: CONFIG.units.warship.hp, cooldown: CONFIG.units.warship.buildTicks });
    expect(g.map.terrain[tileOf(g.map, Math.round(ship.x), Math.round(ship.y))]).toBe(0);
  });

  it('warship sinks an enemy troop boat (troops lost) and ignores neutral ships', () => {
    const g = sea();
    g.relations.set(1, 2, 'war');
    const at = tileOf(g.map, 20, 2);
    spawnUnit(g, { type: 'warship', owner: 1, x: 20, y: 2, hp: CONFIG.units.warship.hp, patrol: at, mission: 'patrol' });
    // b's boat and c's trade ship idle within range (their paths lead far away, slowly)
    const far = tileOf(g.map, 70, 4);
    const boat = spawnUnit(g, { type: 'troopBoat', owner: 2, x: 24, y: 3, troops: 400, path: [far], targetTile: far });
    const trader = spawnUnit(g, { type: 'tradeShip', owner: 3, x: 23, y: 1, path: [far] });
    boat.path = [boat.path[0]];
    const troops2 = g.nations[2].troops;
    let sunk: GameEvent | undefined;
    for (let i = 0; i < 60 && !sunk; i++) {
      stepUnits(g);
      sunk = g.drainEvents().find((e) => e.type === 'unitLost');
      // keep the boat in range: it doesn't get to sail this test
      if (g.units.has(boat.id)) { boat.x = 24; boat.y = 3; }
      if (g.units.has(trader.id)) { trader.x = 23; trader.y = 1; }
    }
    expect(sunk).toEqual({ type: 'unitLost', owner: 2, by: 1, unit: 'troopBoat' });
    expect(g.units.has(boat.id)).toBe(false);
    expect(g.nations[2].troops).toBe(troops2);
    expect(g.units.has(trader.id)).toBe(true);
  });

  it('a warship still being built does not fight', () => {
    const g = sea();
    g.relations.set(1, 2, 'war');
    spawnUnit(g, { type: 'warship', owner: 1, x: 20, y: 2, hp: 10, cooldown: 1000, patrol: tileOf(g.map, 20, 2), mission: 'patrol' });
    const boat = spawnUnit(g, { type: 'troopBoat', owner: 2, x: 21, y: 2, troops: 10, path: [tileOf(g.map, 70, 4)] });
    for (let i = 0; i < 60; i++) {
      stepUnits(g);
      boat.x = 21;
      boat.y = 2;
    }
    expect(g.units.has(boat.id)).toBe(true);
  });

  it('moveWarship rejects land and other water bodies', () => {
    const g = makeTestGame({
      map: ['..........', '.####.....', '.#.#......', '.###......', '..........'],
      owners: ['..........', '.aaaa.....', '.a.a......', '.aaa......', '..........'],
      nations: [{}, {}],
    });
    const ship = spawnUnit(g, { type: 'warship', owner: 1, x: 6, y: 2, hp: 10, patrol: tileOf(g.map, 6, 2), mission: 'patrol' });
    expect(moveWarship(g, 1, ship.id, tileOf(g.map, 1, 1))).toEqual({ ok: false, reason: 'not water' });
    expect(moveWarship(g, 1, ship.id, tileOf(g.map, 2, 2))).toEqual({ ok: false, reason: 'different sea' });
    expect(moveWarship(g, 2, ship.id, tileOf(g.map, 8, 4))).toEqual({ ok: false, reason: 'not your warship' });
    expect(moveWarship(g, 1, ship.id, -5)).toEqual({ ok: false, reason: 'off the map' });
    const dest = tileOf(g.map, 8, 4);
    expect(applyCommand(g, { type: 'moveUnit', nation: 1, unitId: ship.id, tile: dest })).toEqual({ ok: true });
    expect(ship.patrol).toBe(dest);
    for (let i = 0; i < 20; i++) stepUnits(g);
    expect(Math.hypot(ship.x - 8, ship.y - 4)).toBeLessThanOrEqual(CONFIG.units.warship.patrolRadius);
  });
});
