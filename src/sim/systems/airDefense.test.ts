import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { BuildingType, GameEvent, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { radarBoost } from './air';
import { spawnUnit, stepUnits } from './units';
import type { Unit } from './units';

/** 120×9 plains: a holds the west half, b the east; c owns nothing but can fly. */
function front(seed = 1): Game {
  const map = Array.from({ length: 9 }, () => '#'.repeat(120));
  const owners = Array.from({ length: 9 }, () => 'a'.repeat(60) + 'b'.repeat(60));
  return makeTestGame({ map, owners, seed, nations: [{ troops: 10_000, gold: 100_000 }, { troops: 9_000, gold: 100_000 }, {}] });
}

function place(g: Game, owner: NationId, type: BuildingType, tile: TileIndex, ticksLeft = 0): number {
  const id = g.nextId();
  g.buildings.add({ id, type, owner, tile, ticksLeft, cooldown: 0 });
  if (ticksLeft === 0) g.nations[owner].buildingCounts[type]++;
  return id;
}

function run(g: Game, ticks: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    stepUnits(g);
    events.push(...g.drainEvents());
  }
  return events;
}

/** A plane of `owner` held in place at (x, y) for `ticks` ticks (it never gets to fly); returns the damage it took. */
function hold(g: Game, plane: Unit, x: number, y: number, ticks: number): number {
  const hp = plane.hp;
  for (let i = 0; i < ticks && g.units.has(plane.id); i++) {
    plane.x = x;
    plane.y = y;
    stepUnits(g);
    g.drainEvents();
  }
  return hp - (g.units.has(plane.id) ? plane.hp : 0);
}

const far = (g: Game) => tileOf(g.map, 119, 8);

describe('anti-air', () => {
  it('anti-air eventually downs a bomber flying through its radius', () => {
    const g = front();
    place(g, 1, 'airport', tileOf(g.map, 50, 4));
    const target = tileOf(g.map, 100, 4);
    // out of the bombs' reach, under the bombers' flight path
    place(g, 2, 'antiAir', tileOf(g.map, 90, 4));
    let sent = 0;
    const events: GameEvent[] = [];
    for (let i = 0; i < 600 && !events.some((e) => e.type === 'unitLost'); i++) {
      if (applyCommand(g, { type: 'bomb', nation: 1, tile: target }).ok) sent++;
      else g.drainEvents();
      events.push(...run(g, 1));
    }
    expect(events).toContainEqual({ type: 'unitLost', owner: 1, by: 2, unit: 'bomber' });
    expect(sent).toBeLessThanOrEqual(4);
  });

  it('radar boosts anti-air (more kills across 20 seeds)', () => {
    const damage = (radar: boolean): number => {
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const g = front(seed);
        g.relations.set(1, 2, 'war');
        place(g, 2, 'antiAir', tileOf(g.map, 100, 4));
        if (radar) place(g, 2, 'radar', tileOf(g.map, 110, 4));
        const plane = spawnUnit(g, { type: 'bomber', owner: 1, x: 100, y: 4, hp: 1e6, path: [far(g)], targetTile: far(g) });
        total += hold(g, plane, 100, 4, 100);
      }
      return total;
    };
    const plain = damage(false);
    const boosted = damage(true);
    // 2000 shots each: about 300 hits plain, 450 with radar
    expect(plain).toBeGreaterThan(200);
    expect(boosted / plain).toBeGreaterThan(1.25);
    expect(boosted / plain).toBeLessThan(1.8);
  });

  it('anti-air ignores planes of nations not at war', () => {
    const g = front();
    place(g, 2, 'antiAir', tileOf(g.map, 100, 4));
    const neutral = spawnUnit(g, { type: 'tradePlane', owner: 1, x: 100, y: 4, hp: 1, path: [far(g)], targetTile: far(g) });
    expect(hold(g, neutral, 100, 4, 200)).toBe(0);
    g.relations.set(1, 2, 'allied');
    const ally = spawnUnit(g, { type: 'bomber', owner: 1, x: 100, y: 4, hp: 3, path: [far(g)], targetTile: far(g) });
    expect(hold(g, ally, 100, 4, 200)).toBe(0);
    // trade planes of a nation at war are fair game
    g.relations.set(3, 2, 'war');
    const enemy = spawnUnit(g, { type: 'tradePlane', owner: 3, x: 100, y: 4, hp: 1, path: [far(g)], targetTile: far(g) });
    expect(hold(g, enemy, 100, 4, 200)).toBe(1);
    // and a gun still being built does nothing
    const h = makeTestGame({ map: ['#'.repeat(40)], owners: ['a'.repeat(20) + 'b'.repeat(20)], nations: [{}, {}] });
    h.relations.set(1, 2, 'war');
    place(h, 2, 'antiAir', tileOf(h.map, 30, 0), 10);
    const early = spawnUnit(h, { type: 'bomber', owner: 1, x: 30, y: 0, hp: 3, path: [tileOf(h.map, 39, 0)] });
    expect(hold(h, early, 30, 0, 8)).toBe(0);
  });

  it('radarBoost is radar.boost inside an active radar of the owner, else 1', () => {
    const g = front();
    place(g, 2, 'radar', tileOf(g.map, 100, 4));
    place(g, 2, 'radar', tileOf(g.map, 5, 4), 10); // still being built
    const { radius, boost } = CONFIG.buildings.radar;
    expect(radarBoost(g, 2, 100 - radius, 4)).toBe(boost);
    expect(radarBoost(g, 2, 100 - radius - 1, 4)).toBe(1);
    expect(radarBoost(g, 1, 100, 4)).toBe(1);
    expect(radarBoost(g, 2, 5, 4)).toBe(1);
  });
});

describe('radar', () => {
  it('radar warning fires once per incoming bomber', () => {
    const g = front();
    place(g, 1, 'airport', tileOf(g.map, 40, 4));
    place(g, 1, 'airport', tileOf(g.map, 45, 4));
    place(g, 2, 'radar', tileOf(g.map, 115, 4));
    const target = tileOf(g.map, 112, 4);
    expect(applyCommand(g, { type: 'bomb', nation: 1, tile: target })).toEqual({ ok: true });
    expect(applyCommand(g, { type: 'paradrop', nation: 1, tile: target, ratio: 0.1 })).toEqual({ ok: true });
    // c's trade plane passing through is no threat
    spawnUnit(g, { type: 'tradePlane', owner: 3, x: 110, y: 4, hp: 1, path: [far(g)], targetTile: far(g) });
    const warnings = run(g, 80).filter((e): e is Extract<GameEvent, { type: 'radarWarning' }> => e.type === 'radarWarning');
    expect(warnings.map((w) => [w.nation, w.from, w.unit])).toEqual([[2, 1, 'bomber'], [2, 1, 'paraPlane']]);
    const radius = CONFIG.buildings.radar.radius;
    for (const w of warnings) {
      const x = w.tile % g.map.width;
      expect(Math.abs(x - 115)).toBeLessThanOrEqual(radius + 1);
    }
  });
});
