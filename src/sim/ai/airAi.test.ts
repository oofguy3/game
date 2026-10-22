import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { BuildingType, Command, Difficulty, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { distance, tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { chooseParadrop, manageAirDefense } from './air';
import { Bot } from './bot';
import { chooseBuild, findPlacement, rankBuilds } from './economy';
import { perceive } from './perception';

const SEED = 23;

/** 80×9 plains: a holds the west half with plenty of troops and gold, b the east half. */
function front(): Game {
  const map = Array.from({ length: 9 }, () => '#'.repeat(80));
  const owners = Array.from({ length: 9 }, () => 'a'.repeat(40) + 'b'.repeat(40));
  return makeTestGame({ map, owners, nations: [{ troops: 20_000, gold: 50_000 }, { troops: 3_000 }] });
}

function place(g: Game, owner: NationId, type: BuildingType, tile: TileIndex): number {
  const id = g.nextId();
  g.buildings.add({ id, type, owner, tile, ticksLeft: 0, cooldown: 0 });
  g.nations[owner].buildingCounts[type]++;
  return id;
}

const PLANE_COMMANDS = (c: Command): boolean => c.type === 'bomb' || c.type === 'paradrop'
  || (c.type === 'buildUnit' && c.unit === 'fighter');

describe('combined arms', () => {
  it('hard bot bombs a front fortress before attacking, then attacks after the ETA', () => {
    const g = front();
    const airport = tileOf(g.map, 10, 4);
    place(g, 1, 'airport', airport);
    const fortress = tileOf(g.map, 44, 4);
    place(g, 2, 'fortress', fortress);
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    const cmds = bot.think();
    expect(cmds).toContainEqual({ type: 'bomb', nation: 1, tile: fortress });
    expect(cmds.some((c) => c.type === 'attack' && g.owner[c.tile] === 2)).toBe(false);
    const pending = bot.memory.pendingAttack!;
    expect(pending).toMatchObject({ target: 2 });
    expect(g.owner[pending.tile]).toBe(2);
    expect(pending.at).toBe(g.tick + Math.ceil(distance(g.map, airport, fortress) / CONFIG.units.bomber.speed));
    for (const c of cmds) expect(applyCommand(g, c)).toEqual({ ok: true });
    // no attack on b until the bombs have fallen
    while (g.tick < pending.at) {
      const before = bot.think();
      expect(before.some((c) => c.type === 'attack' && g.owner[c.tile] === 2)).toBe(false);
      expect(before.some((c) => c.type === 'bomb')).toBe(false);
      g.step();
    }
    expect(g.buildings.at(fortress)).toBeUndefined();
    const after = bot.think();
    expect(after).toContainEqual({ type: 'attack', nation: 1, tile: pending.tile, ratio: pending.ratio });
    expect(after.filter((c) => c.type === 'attack' && g.owner[c.tile] === 2)).toHaveLength(1);
    expect(bot.memory.pendingAttack).toBeNull();
  });

  it('attacks at once when the front is not fortified', () => {
    const g = front();
    place(g, 1, 'airport', tileOf(g.map, 10, 4));
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    const cmds = bot.think();
    expect(cmds.some((c) => c.type === 'attack' && g.owner[c.tile] === 2)).toBe(true);
    expect(cmds.some((c) => c.type === 'bomb')).toBe(false);
    expect(bot.memory.pendingAttack).toBeNull();
  });

  it('easy bot never uses planes', () => {
    const g = front();
    g.relations.set(1, 2, 'war');
    place(g, 1, 'airport', tileOf(g.map, 10, 4));
    place(g, 2, 'airport', tileOf(g.map, 70, 4));
    place(g, 2, 'fortress', tileOf(g.map, 44, 4));
    place(g, 2, 'city', tileOf(g.map, 72, 2));
    place(g, 2, 'factory', tileOf(g.map, 76, 6));
    const bot = new Bot(g, 1, 'easy', 'aggressive', SEED);
    for (let i = 0; i < 30; i++) {
      g.nations[1].troops = 20_000;
      g.nations[1].gold = 50_000;
      expect(bot.think().filter(PLANE_COMMANDS)).toEqual([]);
    }
    expect(rankBuilds(g, perceive(g, 1), bot).some((r) => r.type === 'airport')).toBe(false);
  });
});

describe('paradrops', () => {
  it('hard bot drops paratroopers on a building cluster far behind the front', () => {
    const g = front();
    g.relations.set(1, 2, 'war');
    place(g, 1, 'airport', tileOf(g.map, 10, 4));
    place(g, 2, 'city', tileOf(g.map, 45, 4)); // at the front: not worth a drop
    place(g, 2, 'factory', tileOf(g.map, 70, 2));
    const centre = tileOf(g.map, 72, 6);
    place(g, 2, 'city', centre);
    place(g, 2, 'bank', tileOf(g.map, 76, 4));
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    const drop = chooseParadrop(g, perceive(g, 1), bot) as Extract<Command, { type: 'paradrop' }>;
    expect(drop).toMatchObject({ type: 'paradrop', nation: 1 });
    expect([tileOf(g.map, 70, 2), centre, tileOf(g.map, 76, 4)]).toContain(drop.tile);
    expect(drop.ratio).toBeLessThanOrEqual(CONFIG.units.paraPlane.maxTroopsShare);
    expect(Math.floor(drop.ratio * g.nations[1].troops)).toBeGreaterThanOrEqual(CONFIG.ai.minParaTroops);
    expect(applyCommand(g, drop)).toEqual({ ok: true });
  });

  it('no paradrop without a war, a big enough budget or an airport in range', () => {
    const setup = (): Game => {
      const g = front();
      g.relations.set(1, 2, 'war');
      place(g, 1, 'airport', tileOf(g.map, 10, 4));
      place(g, 2, 'city', tileOf(g.map, 72, 6));
      return g;
    };
    const drop = (g: Game, difficulty: Difficulty = 'hard') => chooseParadrop(g, perceive(g, 1), new Bot(g, 1, difficulty, 'aggressive', SEED));
    expect(drop(setup())).not.toBeNull();
    expect(drop(setup(), 'normal')).toBeNull(); // no combined arms
    const peace = setup();
    peace.relations.set(1, 2, 'neutral');
    expect(drop(peace)).toBeNull();
    const poor = setup();
    poor.nations[1].troops = 2_000;
    expect(drop(poor)).toBeNull();
    const grounded = setup();
    for (const b of grounded.buildings.ofNation(1, 'airport')) b.cooldown = 50;
    expect(drop(grounded)).toBeNull();
  });
});

describe('air defense', () => {
  it('builds fighters when a war enemy airport covers its land, one per two enemy airports', () => {
    const g = front();
    const mine = place(g, 1, 'airport', tileOf(g.map, 10, 4));
    const bot = new Bot(g, 1, 'hard', 'builder', SEED);
    place(g, 2, 'airport', tileOf(g.map, 70, 2));
    place(g, 2, 'airport', tileOf(g.map, 70, 6));
    place(g, 2, 'airport', tileOf(g.map, 76, 4));
    expect(manageAirDefense(g, perceive(g, 1), bot)).toEqual([]); // not at war
    g.relations.set(1, 2, 'war');
    const cmds = manageAirDefense(g, perceive(g, 1), bot);
    expect(cmds).toEqual([{ type: 'buildUnit', nation: 1, unit: 'fighter', buildingId: mine }]);
    expect(applyCommand(g, cmds[0])).toEqual({ ok: true });
    expect(manageAirDefense(g, perceive(g, 1), bot)).toHaveLength(1); // 3 enemy airports: 2 fighters
    expect(applyCommand(g, manageAirDefense(g, perceive(g, 1), bot)[0])).toEqual({ ok: true });
    expect(manageAirDefense(g, perceive(g, 1), bot)).toEqual([]);
  });

  it('builds anti-air when an enemy airport is in range', () => {
    const map = Array.from({ length: 21 }, () => '#'.repeat(80));
    const owners = Array.from({ length: 21 }, () => 'a'.repeat(40) + 'b'.repeat(40));
    const g = makeTestGame({ map, owners, nations: [{ troops: 20_000, gold: 10_000 }, { troops: 3_000 }] });
    // a's cities, spread over its land
    for (const x of [4, 12, 20, 28, 36]) for (const y of [2, 10, 18]) place(g, 1, 'city', tileOf(g.map, x, y));
    const bot = new Bot(g, 1, 'insane', 'builder', SEED);
    expect(rankBuilds(g, perceive(g, 1), bot).some((r) => r.type === 'antiAir')).toBe(false);
    g.relations.set(1, 2, 'war');
    place(g, 2, 'airport', tileOf(g.map, 70, 10));
    const p = perceive(g, 1);
    expect(rankBuilds(g, p, bot)[0].type).toBe('antiAir');
    const cmd = chooseBuild(g, p, bot) as Extract<Command, { type: 'build' }>;
    expect(cmd).toMatchObject({ type: 'build', nation: 1, building: 'antiAir' });
    // close to the middle of the cities
    expect(distance(g.map, cmd.tile, tileOf(g.map, 20, 10))).toBeLessThanOrEqual(8);
    expect(applyCommand(g, cmd)).toEqual({ ok: true });
    // one gun covers that cluster; radar comes with the second gun
    expect(rankBuilds(g, perceive(g, 1), bot).some((r) => r.type === 'radar')).toBe(false);
    place(g, 1, 'antiAir', tileOf(g.map, 8, 6));
    const ranked = rankBuilds(g, perceive(g, 1), bot);
    expect(ranked.some((r) => r.type === 'radar')).toBe(true);
    const radar = findPlacement(g, 1, 'radar', perceive(g, 1), bot.rng);
    expect(radar).not.toBeNull();
  });

  it('values an airport when an enemy is within range, placed 20+ tiles behind the border', () => {
    const map = Array.from({ length: 60 }, () => '#'.repeat(120));
    const owners = Array.from({ length: 60 }, () => 'a'.repeat(80) + 'b'.repeat(40));
    const g = makeTestGame({ map, owners, nations: [{ troops: 20_000, gold: 50_000 }, { troops: 3_000 }] });
    const p = perceive(g, 1);
    expect(rankBuilds(g, p, new Bot(g, 1, 'easy', 'aggressive', SEED)).some((r) => r.type === 'airport')).toBe(false);
    const bot = new Bot(g, 1, 'hard', 'aggressive', SEED);
    expect(rankBuilds(g, p, bot).some((r) => r.type === 'airport')).toBe(true);
    const tile = findPlacement(g, 1, 'airport', p, bot.rng)!;
    const x = tile % g.map.width;
    expect(80 - 1 - x).toBeGreaterThanOrEqual(20);
    // as close to the front as that allows
    expect(80 - 1 - x).toBeLessThanOrEqual(26);
    // one airport is enough
    place(g, 1, 'airport', tile);
    expect(rankBuilds(g, perceive(g, 1), bot).some((r) => r.type === 'airport')).toBe(false);
  });
});
