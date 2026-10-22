import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { GameEvent } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { startAttack, stepAttacks } from './attacks';
import { boatCap, launchBoat } from './naval';
import { stepUnits } from './units';

/** Two 3-wide islands either side of a 6-wide strait. */
const STRAIT = ['###......###', '###......###', '###......###'];

const boats = (g: Game) => [...g.units.values()].filter((u) => u.type === 'troopBoat');
const rejected = (g: Game): GameEvent[] => g.drainEvents().filter((e) => e.type === 'rejected');

/** Runs units (and attacks) without the economy, so troop counts stay exact. */
function sail(g: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    stepUnits(g);
    stepAttacks(g);
  }
}

describe('troop boats', () => {
  it('a boat crosses water, lands and starts an attack from the beach', () => {
    const g = makeTestGame({ map: STRAIT, owners: ['aaa.........', 'aaa.........', 'aaa.........'], nations: [{ troops: 1000 }] });
    const beach = tileOf(g.map, 9, 1);
    expect(applyCommand(g, { type: 'boat', nation: 1, tile: beach, ratio: 0.5 })).toEqual({ ok: true });
    expect(g.nations[1].troops).toBe(500);
    expect(boats(g)).toEqual([expect.objectContaining({ owner: 1, troops: 500, targetTile: beach })]);
    g.drainEvents();

    sail(g, 30);
    expect(boats(g)).toEqual([]);
    expect(g.owner[beach]).toBe(1);
    const events = g.drainEvents();
    expect(events).toContainEqual({ type: 'landed', nation: 1, tile: beach, troops: 500 });
    // the landing party spread over the rest of the island
    for (const t of [tileOf(g.map, 10, 1), tileOf(g.map, 11, 0), tileOf(g.map, 11, 2)]) expect(g.owner[t]).toBe(1);
  });

  it('rejects inland, own, allied, other-water-body and over-cap launches with reasons', () => {
    const g = makeTestGame({
      map: ['###.......#####', '###.......#####', '###.......#####', '...........#.#.', '...........###.'],
      owners: ['aaa.......bbbbb', 'aaa.......bbbbb', 'aaa.......bbbbb', '...............', '...............'],
      nations: [{ troops: 10_000 }, { troops: 100 }, {}],
    });
    g.drainEvents();
    const reject = (tile: number, reason: string): void => {
      expect(applyCommand(g, { type: 'boat', nation: 1, tile, ratio: 0.1 })).toEqual({ ok: false, reason });
      expect(rejected(g)).toEqual([{ type: 'rejected', nation: 1, reason }]);
    };
    reject(tileOf(g.map, 12, 1), 'not coastal');
    reject(tileOf(g.map, 0, 0), 'own tile');
    reject(-1, 'off the map');
    reject(tileOf(g.map, 5, 0), 'not land');
    // (12,4) is coastal only on the one-tile lake at (12,3), which is ringed by land: no route
    reject(tileOf(g.map, 12, 4), 'no sea route');
    g.relations.set(1, 2, 'allied');
    reject(tileOf(g.map, 10, 0), 'allied');
    g.relations.set(1, 2, 'neutral');

    const cap = boatCap(g, g.nations[1]);
    expect(cap).toBe(CONFIG.units.troopBoat.baseCap);
    for (let i = 0; i < cap; i++) expect(launchBoat(g, 1, tileOf(g.map, 10, 0), 10)).toEqual({ ok: true });
    g.drainEvents();
    reject(tileOf(g.map, 10, 0), 'too many boats out');
  });

  it('allows more boats with ports', () => {
    const g = makeTestGame({ map: STRAIT, owners: ['aaa.........', 'aaa.........', 'aaa.........'], nations: [{}] });
    g.nations[1].buildingCounts.port = 2;
    expect(boatCap(g, g.nations[1])).toBe(CONFIG.units.troopBoat.baseCap + 2 * CONFIG.buildings.port.boatCapBonus);
  });

  it('attack with allowBoat falls back to a boat when not adjacent', () => {
    const g = makeTestGame({ map: STRAIT, owners: ['aaa.........', 'aaa.........', 'aaa.......bb'], nations: [{ troops: 1000 }, { troops: 50 }] });
    const there = tileOf(g.map, 10, 2);
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: there, ratio: 0.5 })).toEqual({ ok: false, reason: 'not adjacent' });
    g.drainEvents();
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: there, ratio: 0.5, allowBoat: true })).toEqual({ ok: true });
    expect(boats(g)).toHaveLength(1);
    // free land across the water, too
    const free = tileOf(g.map, 9, 0);
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: free, ratio: 0.1, allowBoat: true })).toEqual({ ok: true });
    expect(boats(g)).toHaveLength(2);
  });

  it('aims a boat attack at the beach nearest an inland click', () => {
    const g = makeTestGame({ map: STRAIT, owners: ['aaa.........', 'aaa.......bb', 'aaa.......bb'], nations: [{ troops: 1000 }, { troops: 50 }] });
    const inland = tileOf(g.map, 10, 1);
    expect(g.map.coastal[inland]).toBe(0);
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: inland, ratio: 0.5, allowBoat: true })).toEqual({ ok: true });
    // b's land has no coast, so the boat lands on the free beach next to it
    const [boat] = boats(g);
    expect(boat.targetTile).toBe(tileOf(g.map, 9, 1));
    expect(g.map.coastal[boat.targetTile]).toBe(1);
  });

  it('still expands over land when free land on the same landmass is clicked', () => {
    const g = makeTestGame({ map: ['######'], owners: ['aa....'], nations: [{ troops: 1000 }] });
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: 5, ratio: 0.5, allowBoat: true })).toEqual({ ok: true });
    expect(boats(g)).toEqual([]);
    expect(g.attacks).toHaveLength(1);
  });

  it('returns troops when the landing tile became the owner\'s own', () => {
    const g = makeTestGame({ map: STRAIT, owners: ['aaa.........', 'aaa.........', 'aaa.........'], nations: [{ troops: 1000 }] });
    const beach = tileOf(g.map, 9, 1);
    expect(launchBoat(g, 1, beach, 300)).toEqual({ ok: true });
    expect(g.nations[1].troops).toBe(700);
    g.setOwner(beach, 1);
    sail(g, 30);
    expect(boats(g)).toEqual([]);
    expect(g.nations[1].troops).toBe(1000);
  });

  it('holds a disconnected island and attacks from both pieces', () => {
    // open sea along the top so both islands have a coast
    const g = makeTestGame({
      map: ['............', ...STRAIT],
      owners: ['............', 'aab......bbb', 'aab......bbb', 'aab......bbb'],
      nations: [{ troops: 100_000 }, { troops: 60 }],
    });
    expect(launchBoat(g, 1, tileOf(g.map, 9, 2), 5000)).toEqual({ ok: true });
    for (let i = 0; i < 30 && g.owner[tileOf(g.map, 9, 2)] !== 1; i++) sail(g, 1);
    expect(g.owner[tileOf(g.map, 9, 2)]).toBe(1);
    expect(g.attacks).toEqual([expect.objectContaining({ attacker: 1, target: 2 })]);
    // the one attack the landing started pushes on from both of a's pieces
    sail(g, 40);
    expect(g.owner[tileOf(g.map, 2, 2)]).toBe(1);
    expect(g.owner[tileOf(g.map, 11, 2)]).toBe(1);
  });

  it('removes units of an eliminated nation', () => {
    const g = makeTestGame({
      map: ['####......###'],
      owners: ['abbb.........'],
      nations: [{ troops: 100_000 }, { troops: 500 }],
    });
    expect(launchBoat(g, 2, tileOf(g.map, 10, 0), 100)).toEqual({ ok: true });
    expect(boats(g)).toHaveLength(1);
    expect(startAttack(g, 1, 2, 50_000)).toEqual({ ok: true });
    for (let i = 0; i < 10 && g.nations[2].alive; i++) stepAttacks(g);
    expect(g.nations[2].alive).toBe(false);
    expect(boats(g)).toEqual([]);
  });
});
