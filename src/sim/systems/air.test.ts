import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { BuildingType, Command, GameEvent, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { stepAttacks } from './attacks';
import { stepUnits } from './units';

/** 60×9 plains: a holds the west half, b the east. */
function front(width = 60): Game {
  const half = width / 2;
  const map = Array.from({ length: 9 }, () => '#'.repeat(width));
  const owners = Array.from({ length: 9 }, () => 'a'.repeat(half) + 'b'.repeat(half));
  return makeTestGame({ map, owners, nations: [{ troops: 10_000, gold: 100_000 }, { troops: 9_000, gold: 100_000 }, {}] });
}

function place(g: Game, owner: NationId, type: BuildingType, tile: TileIndex, ticksLeft = 0): number {
  const id = g.nextId();
  g.buildings.add({ id, type, owner, tile, ticksLeft, cooldown: 0 });
  if (ticksLeft === 0) g.nations[owner].buildingCounts[type]++;
  return id;
}

const planes = (g: Game, type: string) => [...g.units.values()].filter((u) => u.type === type);

function fly(g: Game, ticks: number, attacks = false): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    stepUnits(g);
    if (attacks) stepAttacks(g);
    events.push(...g.drainEvents());
  }
  return events;
}

describe('bombers', () => {
  it('bomber destroys buildings, kills troops and declares war', () => {
    const g = front();
    place(g, 1, 'airport', tileOf(g.map, 5, 4));
    const city = tileOf(g.map, 45, 4);
    const factory = tileOf(g.map, 47, 4);
    place(g, 2, 'city', city);
    place(g, 2, 'factory', factory);
    const far = tileOf(g.map, 56, 4);
    place(g, 2, 'bank', far);
    const target = tileOf(g.map, 46, 4);
    expect(applyCommand(g, { type: 'bomb', nation: 1, tile: target })).toEqual({ ok: true });
    expect(g.nations[1].gold).toBe(100_000 - CONFIG.units.bomber.cost);
    expect(g.relations.get(1, 2)).toBe('war');
    const troops = g.nations[2].troops;
    const density = troops / g.nations[2].tiles;
    const events = fly(g, 40);
    expect(g.buildings.at(city)).toBeUndefined();
    expect(g.buildings.at(factory)).toBeUndefined();
    expect(g.buildings.at(far)).toBeDefined();
    expect(events.filter((e) => e.type === 'buildingDestroyed').map((e) => (e as { by: number }).by)).toEqual([1, 1]);
    // every b tile within the radius counts
    const { radius, killFactor } = CONFIG.units.bomber;
    let hit = 0;
    for (let y = 0; y < 9; y++) for (let x = 30; x < 60; x++) if ((x - 46) ** 2 + (y - 4) ** 2 <= radius * radius) hit++;
    expect(g.nations[2].troops).toBeCloseTo(troops - density * hit * killFactor, 6);
    // then it flies home and is gone
    fly(g, 40);
    expect(planes(g, 'bomber')).toEqual([]);
  });

  it('rejects bomb/paradrop out of range, at own or allied tiles, or with no airport', () => {
    const g = front(400);
    const reject = (cmd: Command, reason: string): void => {
      const gold = g.nations[1].gold;
      const troops = g.nations[1].troops;
      expect(applyCommand(g, cmd)).toEqual({ ok: false, reason });
      expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: 1, reason }]);
      expect([g.nations[1].gold, g.nations[1].troops]).toEqual([gold, troops]);
    };
    const near = tileOf(g.map, 210, 4);
    reject({ type: 'bomb', nation: 1, tile: near }, 'no airport');
    reject({ type: 'paradrop', nation: 1, tile: near, ratio: 0.2 }, 'no airport');
    const port = place(g, 1, 'airport', tileOf(g.map, 190, 4), 10);
    reject({ type: 'bomb', nation: 1, tile: near }, 'no airport'); // still being built
    g.buildings.byId.get(port)!.ticksLeft = 0;
    reject({ type: 'bomb', nation: 1, tile: tileOf(g.map, 395, 4) }, 'out of range');
    reject({ type: 'bomb', nation: 1, tile: tileOf(g.map, 100, 4) }, 'own tile');
    reject({ type: 'paradrop', nation: 1, tile: tileOf(g.map, 100, 4), ratio: 0.2 }, 'own tile');
    reject({ type: 'bomb', nation: 1, tile: -3 }, 'off the map');
    g.relations.set(1, 2, 'allied');
    reject({ type: 'bomb', nation: 1, tile: near }, 'allied');
    reject({ type: 'paradrop', nation: 1, tile: near, ratio: 0.2 }, 'allied');
    g.relations.set(1, 2, 'neutral');
    g.nations[1].gold = CONFIG.units.bomber.cost - 1;
    reject({ type: 'bomb', nation: 1, tile: near }, 'not enough gold');
    g.nations[1].gold = 100_000;
    expect(applyCommand(g, { type: 'bomb', nation: 1, tile: near })).toEqual({ ok: true });
    g.drainEvents();
    reject({ type: 'paradrop', nation: 1, tile: near, ratio: 0.2 }, 'airport busy');
  });
});

describe('paratroopers', () => {
  it('paratroopers land far behind the front and start an attack from there', () => {
    const g = front();
    place(g, 1, 'airport', tileOf(g.map, 5, 4));
    const drop = tileOf(g.map, 55, 4);
    const troops = g.nations[1].troops;
    expect(applyCommand(g, { type: 'paradrop', nation: 1, tile: drop, ratio: 0.9 })).toEqual({ ok: true });
    // at most maxTroopsShare of the troops jump
    const [plane] = planes(g, 'paraPlane');
    expect(plane.troops).toBe(Math.floor(troops * CONFIG.units.paraPlane.maxTroopsShare));
    expect(g.nations[1].troops).toBe(troops - plane.troops);
    expect(g.relations.get(1, 2)).toBe('war');
    const events = fly(g, 40, true);
    expect(events).toContainEqual(expect.objectContaining({ type: 'landed', nation: 1, tile: drop }));
    expect(planes(g, 'paraPlane')).toEqual([]);
    expect(g.owner[drop]).toBe(1);
    // the pocket grows behind b's lines
    expect(g.owner[tileOf(g.map, 56, 4)]).toBe(1);
    expect(g.owner[tileOf(g.map, 31, 4)]).toBe(2);
  });
});

describe('trade planes', () => {
  it('trade planes pay both sides', () => {
    const g = front();
    place(g, 1, 'airport', tileOf(g.map, 5, 4));
    place(g, 2, 'airport', tileOf(g.map, 55, 4));
    const gold = [g.nations[1].gold, g.nations[2].gold];
    const trades = fly(g, 120).filter((e): e is Extract<GameEvent, { type: 'trade' }> => e.type === 'trade');
    expect(new Set(trades.map((t) => t.nation))).toEqual(new Set([1, 2]));
    const paid = (n: number) => trades.filter((t) => t.nation === n).reduce((s, t) => s + t.gold, 0);
    expect(g.nations[1].gold).toBeCloseTo(gold[0] + paid(1), 6);
    expect(g.nations[2].gold).toBeCloseTo(gold[1] + paid(2), 6);
    expect(trades[0].gold).toBeGreaterThan(CONFIG.units.tradePlane.goldBase);
  });

  it('no trade planes between nations at war', () => {
    const g = front();
    place(g, 1, 'airport', tileOf(g.map, 5, 4));
    place(g, 2, 'airport', tileOf(g.map, 55, 4));
    g.relations.set(1, 2, 'war');
    expect(fly(g, 120).filter((e) => e.type === 'trade')).toEqual([]);
    expect(planes(g, 'tradePlane')).toEqual([]);
  });
});

describe('fighters', () => {
  it('buildFighter builds at an active airport the nation owns, for gold', () => {
    const g = front();
    const port = place(g, 1, 'airport', tileOf(g.map, 5, 4));
    expect(applyCommand(g, { type: 'buildUnit', nation: 2, unit: 'fighter', buildingId: port })).toEqual({ ok: false, reason: 'not your airport' });
    expect(applyCommand(g, { type: 'buildUnit', nation: 1, unit: 'fighter', buildingId: port })).toEqual({ ok: true });
    expect(g.nations[1].gold).toBe(100_000 - CONFIG.units.fighter.cost);
    expect(planes(g, 'fighter')).toEqual([expect.objectContaining({ owner: 1, hp: CONFIG.units.fighter.hp, cooldown: CONFIG.units.fighter.buildTicks })]);
  });

  it('a fighter shoots down an enemy bomber', () => {
    const g = front();
    const home = place(g, 1, 'airport', tileOf(g.map, 20, 4));
    place(g, 2, 'airport', tileOf(g.map, 55, 4));
    expect(applyCommand(g, { type: 'buildUnit', nation: 1, unit: 'fighter', buildingId: home })).toEqual({ ok: true });
    planes(g, 'fighter')[0].cooldown = 0;
    expect(applyCommand(g, { type: 'bomb', nation: 2, tile: tileOf(g.map, 18, 4) })).toEqual({ ok: true });
    const events = fly(g, 80);
    expect(events).toContainEqual({ type: 'unitLost', owner: 2, by: 1, unit: 'bomber' });
    expect(planes(g, 'bomber')).toEqual([]);
  });

  it('a plane whose home airport was captured mid-mission despawns cleanly', () => {
    const g = front();
    const homeTile = tileOf(g.map, 5, 4);
    const home = place(g, 1, 'airport', homeTile);
    expect(applyCommand(g, { type: 'bomb', nation: 1, tile: tileOf(g.map, 46, 4) })).toEqual({ ok: true });
    expect(applyCommand(g, { type: 'buildUnit', nation: 1, unit: 'fighter', buildingId: home })).toEqual({ ok: true });
    fly(g, 5);
    g.setOwner(homeTile, 2); // b takes the airport while the bomber is out
    const events = fly(g, 60);
    expect(planes(g, 'bomber')).toEqual([]);
    expect(planes(g, 'fighter')).toEqual([]);
    expect(events.filter((e) => e.type === 'unitLost')).toEqual([]);
  });
});
