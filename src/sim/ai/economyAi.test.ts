import { describe, expect, it } from 'vitest';
import type { Command, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { distance } from '../map/grid';
import { buildingCost } from '../systems/buildings';
import { declareWar } from '../systems/relations';
import { makeTestGame } from '../testing/fixtures';
import { Bot } from './bot';
import { chooseBuild, findPlacement, rankBuilds, troopGoldValue } from './economy';
import { perceive } from './perception';

const SEED = 77;
type BuildCommand = Extract<Command, { type: 'build' }>;

/** Distance from `tile` to the nearest tile owned by `owner`. */
function distanceTo(g: Game, tile: TileIndex, owner: NationId): number {
  let best = Infinity;
  for (let t = 0; t < g.owner.length; t++) if (g.owner[t] === owner) best = Math.min(best, distance(g.map, tile, t));
  return best;
}

const strip = (width: number, height: number, owners: (x: number) => string): string[][] => {
  const map: string[] = [];
  const own: string[] = [];
  for (let y = 0; y < height; y++) {
    map.push('#'.repeat(width));
    let row = '';
    for (let x = 0; x < width; x++) row += owners(x);
    own.push(row);
  }
  return [map, own];
};

describe('troopGoldValue', () => {
  it('is income per troop of growth', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aaaa'], nations: [{ troops: 100 }] });
    const p = perceive(g, 1);
    expect(troopGoldValue(p)).toBeCloseTo(p.income / Math.max(1, p.growth), 12);
    expect(troopGoldValue({ ...p, growth: 0 })).toBeCloseTo(p.income, 12);
  });
});

describe('chooseBuild', () => {
  it('builds economy first with no threats', () => {
    const [map, owners] = strip(20, 10, () => 'a');
    const g = makeTestGame({ map, owners, nations: [{ troops: 3000, gold: 100_000 }] });
    const bot = new Bot(g, 1, 'insane', 'builder', SEED);
    const p = perceive(g, 1);
    expect(rankBuilds(g, p, bot).find((r) => r.type === 'defensePost' || r.type === 'fortress')).toBeUndefined();
    const cmd = chooseBuild(g, p, bot) as BuildCommand;
    expect(cmd).toMatchObject({ type: 'build', nation: 1 });
    expect(['factory', 'city', 'bank', 'barracks']).toContain(cmd.building);
    expect(applyCommand(g, cmd)).toEqual({ ok: true });
  });

  it('builds a defense facing a strong hostile neighbour, within 10 tiles of that border', () => {
    const [map, owners] = strip(30, 10, (x) => (x < 10 ? 'b' : 'a'));
    const g = makeTestGame({ map, owners, nations: [{ troops: 3000, gold: 100_000 }, { troops: 30_000 }] });
    declareWar(g, 1, 2);
    const bot = new Bot(g, 1, 'insane', 'builder', SEED);
    const cmd = chooseBuild(g, perceive(g, 1), bot) as BuildCommand;
    expect(['defensePost', 'fortress']).toContain(cmd.building);
    expect(distanceTo(g, cmd.tile, 2)).toBeLessThanOrEqual(10);
    expect(applyCommand(g, cmd)).toEqual({ ok: true });
  });

  it('saves for a better building instead of buying a worse one', () => {
    // a trader with a large trade income values a bank (2000 gold) above a factory or city (1000)
    const g = makeTestGame({ map: ['####'], owners: ['aa..'], nations: [{ troops: 1000, tradeIncome: 200 }] });
    const bot = new Bot(g, 1, 'insane', 'trader', SEED);
    const bank = buildingCost(g, 1, 'bank');
    g.nations[1].gold = bank - 1;
    const p = perceive(g, 1);
    const ranked = rankBuilds(g, p, bot);
    expect(ranked[0].type).toBe('bank');
    expect(ranked.some((r) => buildingCost(g, 1, r.type) <= p.gold)).toBe(true);
    // the bank is a tick of income away: wait for it
    expect(chooseBuild(g, p, bot)).toBeNull();

    // a bank out of reach for longer than the saving horizon: buy the best thing affordable now
    g.nations[1].gold = 1000;
    const poor = perceive(g, 1);
    expect(poor.gold + poor.income * 300).toBeLessThan(bank);
    const cmd = chooseBuild(g, poor, bot) as BuildCommand;
    expect(cmd.building).not.toBe('bank');
    expect(buildingCost(g, 1, cmd.building)).toBeLessThanOrEqual(poor.gold);
  });

  it('builds nothing when nothing is affordable or worth building soon', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aa..'], nations: [{ troops: 1000, gold: 0 }] });
    const bot = new Bot(g, 1, 'insane', 'builder', SEED);
    expect(chooseBuild(g, perceive(g, 1), bot)).toBeNull();
  });
});

describe('findPlacement', () => {
  it('places cities away from foreign borders', () => {
    const [map, owners] = strip(60, 10, (x) => (x < 10 ? 'b' : 'a'));
    const g = makeTestGame({ map, owners, nations: [{ troops: 3000, gold: 100_000 }, { troops: 3000 }] });
    const bot = new Bot(g, 1, 'insane', 'builder', SEED);
    const tile = findPlacement(g, 1, 'city', perceive(g, 1), bot.rng);
    expect(tile).not.toBeNull();
    expect(distanceTo(g, tile!, 2)).toBeGreaterThanOrEqual(20);
  });

  it('places ports only on coastal tiles', () => {
    const g = makeTestGame({
      map: ['##########', '##########', '##########', '..........'],
      owners: ['aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaaaaaaa', '..........'],
      nations: [{ gold: 100_000 }],
    });
    const bot = new Bot(g, 1, 'insane', 'trader', SEED);
    for (let i = 0; i < 10; i++) {
      const tile = findPlacement(g, 1, 'port', perceive(g, 1), bot.rng);
      expect(tile).not.toBeNull();
      expect(g.map.coastal[tile!]).toBe(1);
    }

    // a nation with no coast gets no port
    const inland = makeTestGame({
      map: ['#####', '#####', '#####'],
      owners: ['bbbbb', 'bbabb', 'bbbbb'],
      nations: [{ gold: 100_000 }, {}],
    });
    const inlandBot = new Bot(inland, 1, 'insane', 'trader', SEED);
    expect(findPlacement(inland, 1, 'port', perceive(inland, 1), inlandBot.rng)).toBeNull();
  });
});
