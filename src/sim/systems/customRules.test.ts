import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import { DEFAULT_RULES } from '../../shared/rules';
import type { MatchRules } from '../../shared/rules';
import type { BuildingType, GameEvent, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { scaledTicks } from '../core/tuning';
import { tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { buildFighter } from './air';
import { stepBuildings } from './buildings';
import { goldIncome, maxTroops, troopGrowth } from './economy';
import { buildWarship, payTrade } from './naval';
import { spawnNation } from './spawn';
import { checkVictory } from './victory';

const plains = (width: number, height: number): string[] => Array.from({ length: height }, () => '#'.repeat(width));

/** Two nations side by side on a 10×3 strip: a holds the west 6 columns, b the east 4. */
const twoNations = (rules?: Partial<MatchRules>): Game => makeTestGame({
  map: plains(10, 3), owners: Array.from({ length: 3 }, () => 'aaaaaabbbb'),
  nations: [{ troops: 1000, gold: 100_000 }, { troops: 1000 }], rules,
});

/** Puts a finished building of `type` for `owner` on `tile`. */
function place(g: Game, owner: NationId, type: BuildingType, tile: TileIndex): number {
  const id = g.nextId();
  g.buildings.add({ id, type, owner, tile, ticksLeft: 0, cooldown: 0 });
  g.nations[owner].buildingCounts[type]++;
  return id;
}

const trades = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { type: 'trade' }> => e.type === 'trade');

describe('custom rules', () => {
  it('a game without rules uses the defaults', () => {
    expect(makeTestGame({ map: ['##'], nations: [{}] }).rules).toEqual(DEFAULT_RULES);
  });

  it('rich start: a spawn gets 5,000 gold, and income and trade gold double', () => {
    const spawnGold = (rules?: Partial<MatchRules>): number => {
      const g = makeTestGame({ map: plains(21, 21), nations: [{}], rules });
      g.phase = 'spawn';
      expect(spawnNation(g, g.nations[1], tileOf(g.map, 10, 10))).toEqual({ ok: true });
      return g.nations[1].gold;
    };
    expect(spawnGold()).toBe(CONFIG.spawn.startGold);
    expect(spawnGold({ richStart: true })).toBe(5000);

    const income = (rules?: Partial<MatchRules>): number => {
      const g = twoNations(rules);
      const n = g.nations[1];
      n.buildingCounts.factory = 2;
      n.buildingCounts.bank = 1;
      return goldIncome(g, n);
    };
    expect(income({ richStart: true })).toBeCloseTo(2 * income(), 10);

    const trade = (rules?: Partial<MatchRules>) => {
      const g = twoNations(rules);
      place(g, 1, 'bank', tileOf(g.map, 0, 0));
      const n = g.nations[1];
      const gold = n.gold;
      payTrade(g, 1, 2, 100);
      return { paid: n.gold - gold, earned: n.stats.goldEarned, income: n.tradeIncome, event: trades(g.drainEvents())[0].gold };
    };
    const plain = trade();
    const rich = trade({ richStart: true });
    expect(plain.paid).toBeCloseTo(100 * (1 + CONFIG.buildings.bank.tradeBonus), 10);
    for (const key of ['paid', 'earned', 'income', 'event'] as const) expect(rich[key]).toBeCloseTo(2 * plain[key], 10);
  });

  it('fast building: a fortress finishes after 20 ticks', () => {
    const g = twoNations({ fastBuilding: true });
    const tile = tileOf(g.map, 2, 1);
    expect(applyCommand(g, { type: 'build', nation: 1, building: 'fortress', tile })).toEqual({ ok: true });
    for (let i = 0; i < 19; i++) stepBuildings(g);
    expect(g.buildings.at(tile)?.ticksLeft).toBe(1);
    expect(g.drainEvents().filter((e) => e.type === 'buildingDone')).toEqual([]);
    stepBuildings(g);
    expect(g.drainEvents()).toContainEqual({ type: 'buildingDone', nation: 1, building: 'fortress', tile });
    expect(g.nations[1].buildingCounts.fortress).toBe(1);
  });

  it('fast building: warships and fighters are ready 5 times sooner', () => {
    const coast = (rules?: Partial<MatchRules>) => {
      const g = makeTestGame({
        map: Array.from({ length: 3 }, () => '##' + '.'.repeat(8)), owners: Array.from({ length: 3 }, () => 'aa' + '.'.repeat(8)),
        nations: [{ gold: 100_000 }], rules,
      });
      const base = place(g, 1, 'navalBase', tileOf(g.map, 1, 1));
      const airport = place(g, 1, 'airport', tileOf(g.map, 0, 0));
      expect(buildWarship(g, 1, base)).toEqual({ ok: true });
      expect(buildFighter(g, 1, airport)).toEqual({ ok: true });
      const cooldown = (type: string) => [...g.units.values()].find((u) => u.type === type)?.cooldown;
      return { warship: cooldown('warship'), fighter: cooldown('fighter') };
    };
    expect(coast()).toEqual({ warship: CONFIG.units.warship.buildTicks, fighter: CONFIG.units.fighter.buildTicks });
    expect(coast({ fastBuilding: true })).toEqual({
      warship: scaledTicks(CONFIG.units.warship.buildTicks, 0.2), fighter: scaledTicks(CONFIG.units.fighter.buildTicks, 0.2),
    });
    expect(scaledTicks(CONFIG.units.warship.buildTicks, 0.2)).toBe(CONFIG.units.warship.buildTicks / 5);
  });

  it('big armies: the troop limit and growth double', () => {
    const { baseGrowth, growthRate, overMaxDecay } = CONFIG.troops;
    const nation = (rules?: Partial<MatchRules>) => {
      const g = twoNations(rules);
      const n = g.nations[1];
      n.buildingCounts.city = 1;
      n.buildingCounts.barracks = 1;
      return { g, n };
    };
    const plain = nation();
    const big = nation({ bigArmies: true });
    const plainMax = maxTroops(plain.g, plain.n);
    const bigMax = maxTroops(big.g, big.n);
    expect(bigMax).toBe(2 * plainMax);

    const barracks = 1 + CONFIG.buildings.barracks.growthBonus;
    plain.n.troops = 0;
    big.n.troops = 0;
    expect(troopGrowth(big.g, big.n)).toBeCloseTo(2 * troopGrowth(plain.g, plain.n), 10);
    big.n.troops = plainMax;
    expect(troopGrowth(big.g, big.n)).toBeCloseTo(2 * (baseGrowth + growthRate * plainMax * (1 - plainMax / bigMax)) * barracks, 6);
    // the decay above the limit stays as it is
    big.n.troops = bigMax + 1000;
    expect(troopGrowth(big.g, big.n)).toBeCloseTo(-overMaxDecay * 1000, 10);
  });

  it('win at 60%: holding 60% of the land wins; win at 100%: 99% is not enough', () => {
    const sixty = (rules?: Partial<MatchRules>) =>
      makeTestGame({ map: ['##########'], owners: ['aaaaaab...'], nations: [{}, {}], victory: true, rules });
    expect(checkVictory(sixty())).toBeNull();
    expect(checkVictory(sixty({ winShare: 0.6 }))).toEqual({ winners: [1], reason: 'landShare' });

    const all = makeTestGame({
      map: plains(10, 10), owners: [...Array.from({ length: 9 }, () => 'a'.repeat(10)), 'a'.repeat(9) + 'b'],
      nations: [{}, {}], victory: true, rules: { winShare: 1 },
    });
    expect(checkVictory(all)).toBeNull();
    all.setOwner(99, 1);
    expect(checkVictory(all)).toEqual({ winners: [1], reason: 'landShare' });
  });
});
