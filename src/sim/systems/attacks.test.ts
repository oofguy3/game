import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { Command, GameEvent, NationId } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { makeTestGame } from '../testing/fixtures';
import { cancelAttacksBetween, landTroops, sharesBorder, startAttack, stepAttacks } from './attacks';
import { tileCaptureCost } from './combat';

const { baseCost, densityFactor, neutralCost, frontFraction, minTilesPerTick, maxTilesPerTick } = CONFIG.combat;

const attack = (nation: NationId, tile: number, ratio: number, allowBoat?: boolean): Command =>
  ({ type: 'attack', nation, tile, ratio, ...(allowBoat === undefined ? {} : { allowBoat }) });

const ownedBy = (g: Game, id: NationId): number[] => {
  const tiles: number[] = [];
  for (let t = 0; t < g.owner.length; t++) if (g.owner[t] === id) tiles.push(t);
  return tiles;
};

/** Advances only the attacks, `n` ticks, so the economy's troop growth doesn't blur the combat arithmetic. */
const steps = (g: Game, n: number) => {
  for (let i = 0; i < n; i++) stepAttacks(g);
};

/** Everything an invalid command must leave untouched. */
const snapshot = (g: Game) => ({
  owner: g.owner.slice(),
  troops: g.nations.map((n) => n.troops),
  tiles: g.nations.map((n) => n.tiles),
  attacks: g.attacks.length,
  relations: g.nations.map((a) => g.nations.map((b) => g.relations.get(a.id, b.id))),
});

describe('sharesBorder', () => {
  it('is true for land neighbours and false across water', () => {
    const g = makeTestGame({ map: ['###.##'], owners: ['ab...c'], nations: [{}, {}, {}] });
    expect(sharesBorder(g, 1, 2)).toBe(true);
    expect(sharesBorder(g, 2, 1)).toBe(true);
    expect(sharesBorder(g, 1, 3)).toBe(false);
    expect(sharesBorder(g, 2, 3)).toBe(false);
  });

  it('with 0 means touching unowned land, and water does not count', () => {
    const g = makeTestGame({ map: ['##.##'], owners: ['a.b..'], nations: [{}, {}] });
    expect(sharesBorder(g, 1, 0)).toBe(true);
    expect(sharesBorder(g, 2, 0)).toBe(true);
    const island = makeTestGame({ map: ['#.#'], owners: ['a.b'], nations: [{}, {}] });
    expect(sharesBorder(island, 1, 0)).toBe(false);
  });
});

describe('attack command', () => {
  it('expands into neutral land and finishes', () => {
    const g = makeTestGame({ map: ['##########'], owners: ['a.........'], nations: [{ troops: 1000 }] });
    expect(applyCommand(g, { type: 'attack', nation: 1, tile: 5, ratio: 0.5 }).ok).toBe(true);
    steps(g, 50);
    expect(g.nations[1].tiles).toBe(10);
    expect(g.attacks).toHaveLength(0);
    expect(g.nations[1].troops).toBeLessThan(1000);
    expect(g.nations[1].troops).toBeCloseTo(1000 - 9 * neutralCost, 10);
    expect(g.nations[1].stats.tilesCaptured).toBe(9);
  });

  it('spreads into all unowned land on the border, not just near the clicked tile', () => {
    const g = makeTestGame({ map: ['#######'], owners: ['...a...'], nations: [{ troops: 1000 }] });
    expect(applyCommand(g, attack(1, 6, 0.5)).ok).toBe(true);
    steps(g, 20);
    expect(g.nations[1].tiles).toBe(7);
  });

  it('subtracts the floored share of troops from the pool and emits attackStarted', () => {
    const g = makeTestGame({ map: ['####'], owners: ['a...'], nations: [{ troops: 1001 }] });
    expect(applyCommand(g, attack(1, 1, 0.5))).toEqual({ ok: true });
    expect(g.nations[1].troops).toBe(501);
    expect(g.attacks).toHaveLength(1);
    expect(g.attacks[0]).toMatchObject({ attacker: 1, target: 0, troops: 500 });
    expect(g.drainEvents()).toEqual([{ type: 'attackStarted', attacker: 1, target: 0, troops: 500 }]);
  });

  it('clamps the ratio to [minAttackRatio, 1]', () => {
    const sent = (ratio: number): number => {
      const g = makeTestGame({ map: ['####'], owners: ['a...'], nations: [{ troops: 1000 }] });
      applyCommand(g, attack(1, 1, ratio));
      return 1000 - g.nations[1].troops;
    };
    expect(sent(5)).toBe(1000);
    expect(sent(1)).toBe(1000);
    expect(sent(0)).toBe(Math.floor(1000 * CONFIG.combat.minAttackRatio));
    expect(sent(-3)).toBe(Math.floor(1000 * CONFIG.combat.minAttackRatio));
  });

  it('rejects own tile, water, off-map and non-adjacent targets with one event each', () => {
    // a at 0, b at 1, unowned land at 2, water at 3, unowned land at 4-5, c at 6
    const g = makeTestGame({ map: ['###.###'], owners: ['ab....c'], nations: [{ troops: 1000 }, { troops: 100 }, {}] });
    const cases: [Command, string][] = [
      [attack(1, 0, 0.5), 'own tile'],
      [attack(1, 3, 0.5), 'not land'],
      [attack(1, -1, 0.5), 'off the map'],
      [attack(1, 7, 0.5), 'off the map'],
      [attack(1, 1.5, 0.5), 'off the map'],
      [attack(1, Number.NaN, 0.5), 'off the map'],
      [attack(1, 6, 0.5), 'not adjacent'],
      [attack(1, 4, 0.5), 'not adjacent'],
      [attack(1, 2, 0.5), 'not adjacent'],
      [attack(1, 6, 0.5, true), 'not adjacent'],
      [attack(1, 1, Number.NaN), 'not enough troops'],
    ];
    for (const [cmd, reason] of cases) {
      const before = snapshot(g);
      expect(applyCommand(g, cmd)).toEqual({ ok: false, reason });
      expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: 1, reason }]);
      expect(snapshot(g)).toEqual(before);
    }
  });

  it('rejects an attack that would send less than one troop', () => {
    const g = makeTestGame({ map: ['##'], owners: ['ab'], nations: [{ troops: 1.5 }, { troops: 100 }] });
    const before = snapshot(g);
    expect(applyCommand(g, attack(1, 1, 0.5))).toEqual({ ok: false, reason: 'not enough troops' });
    expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: 1, reason: 'not enough troops' }]);
    expect(snapshot(g)).toEqual(before);
  });

  it('attacking a nation declares war; attacking an ally is rejected', () => {
    const g = makeTestGame({ map: ['###'], owners: ['abc'], nations: [{ troops: 1000 }, { troops: 100 }, { troops: 100 }] });
    expect(applyCommand(g, attack(1, 1, 0.1))).toEqual({ ok: true });
    expect(g.relations.get(1, 2)).toBe('war');
    expect(g.drainEvents()).toEqual([
      { type: 'relation', a: 1, b: 2, relation: 'war' },
      { type: 'attackStarted', attacker: 1, target: 2, troops: 100 },
    ]);
    // a second attack on a nation already at war declares nothing new
    expect(applyCommand(g, attack(1, 1, 0.1))).toEqual({ ok: true });
    expect(g.drainEvents()).toEqual([{ type: 'attackStarted', attacker: 1, target: 2, troops: 90 }]);

    g.relations.set(2, 3, 'allied');
    const before = snapshot(g);
    expect(applyCommand(g, attack(2, 2, 0.5))).toEqual({ ok: false, reason: 'allied' });
    expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: 2, reason: 'allied' }]);
    expect(snapshot(g)).toEqual(before);
    expect(g.relations.get(2, 3)).toBe('allied');
  });
});

describe('stepAttacks', () => {
  it('stops when troops run out and returns the remainder', () => {
    const g = makeTestGame({ map: ['##########'], owners: ['a.........'], nations: [{ troops: 11 }] });
    expect(applyCommand(g, attack(1, 1, 1)).ok).toBe(true);
    expect(g.nations[1].troops).toBe(0);
    steps(g, 30);
    // each plains tile costs 2: five tiles use 10 troops, the last troop comes home
    expect(g.nations[1].tiles).toBe(6);
    expect(g.attacks).toHaveLength(0);
    expect(g.nations[1].troops).toBe(1);
  });

  it('defender loses troops per tile and is eliminated at 0 tiles', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aabb'], nations: [{ troops: 1000 }, { troops: 100 }] });
    expect(applyCommand(g, attack(1, 2, 0.5)).ok).toBe(true);
    g.drainEvents();
    const cost = baseCost + 50 * densityFactor; // b's density stays 50: it loses 50 troops per tile
    stepAttacks(g);
    expect(g.nations[2].tiles).toBe(1);
    expect(g.nations[2].troops).toBeCloseTo(50, 10);
    expect(g.attacks[0].troops).toBeCloseTo(500 - cost, 10);
    expect(g.nations[2].alive).toBe(true);
    stepAttacks(g);
    expect(g.nations[2].tiles).toBe(0);
    expect(g.nations[2].troops).toBeCloseTo(0, 10);
    expect(g.nations[2].alive).toBe(false);
    expect(g.drainEvents()).toEqual([{ type: 'eliminated', nation: 2, by: 1 }]);
    // the attack ends with its target and the rest comes home
    expect(g.attacks).toHaveLength(0);
    expect(g.nations[1].troops).toBeCloseTo(1000 - 2 * cost, 10);
    expect(g.nations[1].stats.tilesCaptured).toBe(2);
  });

  it('an eliminated nation loses its own attacks and their troops', () => {
    // a at 0, b at 1 (its only tile), c at 2-4
    const g = makeTestGame({
      map: ['#####'], owners: ['abccc'], nations: [{ troops: 1000 }, { troops: 200 }, { troops: 300 }],
    });
    expect(applyCommand(g, attack(1, 1, 0.5)).ok).toBe(true);
    expect(applyCommand(g, attack(2, 2, 0.5)).ok).toBe(true);
    expect(g.nations[2].troops).toBe(100);
    g.drainEvents();
    stepAttacks(g);
    expect(g.nations[2].alive).toBe(false);
    expect(g.nations[2].troops).toBe(0);
    expect(g.attacks).toHaveLength(0);
    expect(ownedBy(g, 3)).toEqual([2, 3, 4]);
    expect(g.drainEvents()).toEqual([{ type: 'eliminated', nation: 2, by: 1 }]);
    expect(g.nations[1].troops).toBeCloseTo(1000 - (baseCost + 100 * densityFactor), 10);
  });

  it('an attack whose target dies elsewhere ends and its troops come home', () => {
    const g = makeTestGame({ map: ['###'], owners: ['abc'], nations: [{ troops: 1000 }, {}, { troops: 1000 }] });
    expect(applyCommand(g, attack(1, 1, 0.5)).ok).toBe(true);
    expect(applyCommand(g, attack(3, 1, 0.5)).ok).toBe(true);
    stepAttacks(g);
    expect(g.owner[1]).toBe(1);
    expect(g.nations[2].alive).toBe(false);
    expect(g.attacks).toHaveLength(0);
    expect(g.nations[3].troops).toBe(1000);
  });

  it('opposing attacks cancel out', () => {
    const g = makeTestGame({ map: ['####'], owners: ['aabb'], nations: [{ troops: 1000 }, { troops: 1000 }] });
    expect(applyCommand(g, attack(1, 2, 0.3))).toEqual({ ok: true });
    expect(applyCommand(g, attack(2, 1, 0.2))).toEqual({ ok: true });
    // both lose 200: a's attack keeps 100 and b's never starts
    expect(g.attacks).toHaveLength(1);
    expect(g.attacks[0]).toMatchObject({ attacker: 1, target: 2, troops: 100 });
    expect([g.nations[1].troops, g.nations[2].troops]).toEqual([700, 800]);
    // a bigger counterattack wipes a's attack out and carries on with the rest
    expect(applyCommand(g, attack(2, 1, 0.5))).toEqual({ ok: true });
    expect(g.attacks).toHaveLength(1);
    expect(g.attacks[0]).toMatchObject({ attacker: 2, target: 1, troops: 300 });
    expect([g.nations[1].troops, g.nations[2].troops]).toEqual([700, 400]);
  });

  it('a second attack on the same target merges into the first', () => {
    const g = makeTestGame({ map: ['##########'], owners: ['a.........'], nations: [{ troops: 1000 }] });
    expect(applyCommand(g, attack(1, 1, 0.1)).ok).toBe(true);
    expect(applyCommand(g, attack(1, 1, 0.5)).ok).toBe(true);
    expect(g.attacks).toHaveLength(1);
    expect(g.attacks[0].troops).toBe(100 + 450);
  });

  it('a second attack also takes land that has come within reach since the first began', () => {
    // row 0: a and a long unowned corridor; row 2: a, b (its only tile, no troops), then a pocket only b touches
    const g = makeTestGame({
      map: ['#'.repeat(30), '.'.repeat(30), '####' + '.'.repeat(26)],
      owners: ['a' + '.'.repeat(29), '.'.repeat(30), 'ab' + '.'.repeat(28)],
      nations: [{ troops: 10000 }, { troops: 0 }],
    });
    expect(applyCommand(g, attack(1, 1, 0.01)).ok).toBe(true);
    expect(applyCommand(g, attack(1, 61, 0.01)).ok).toBe(true);
    stepAttacks(g);
    expect(g.nations[2].alive).toBe(false);
    // the pocket (62-63) now touches a, but the corridor attack never saw it; a click there must reach it
    expect(applyCommand(g, attack(1, 62, 0.5)).ok).toBe(true);
    expect(g.attacks).toHaveLength(1);
    steps(g, 10);
    expect([g.owner[62], g.owner[63]]).toEqual([1, 1]);
    // ... while the corridor attack is still under way
    expect(g.attacks).toHaveLength(1);
    expect(g.owner[29]).toBe(0);
  });

  it('skips frontier tiles that changed hands without spending speed on them', () => {
    // b's frontier: S (tile 1, two b neighbours, popped first) and V (tile 7, one b neighbour). a takes S first.
    const g = makeTestGame({
      map: ['###', '.#.', '.#.'], owners: ['a.b', '.b.', '...'], nations: [{ troops: 1000 }, { troops: 1000 }],
    });
    expect(applyCommand(g, attack(1, 1, 0.5)).ok).toBe(true);
    expect(applyCommand(g, attack(2, 7, 0.5)).ok).toBe(true);
    stepAttacks(g);
    expect(g.owner[1]).toBe(1);
    // b's one speed point still paid for V after S turned out stale
    expect(g.owner[7]).toBe(2);
    stepAttacks(g);
    expect(g.attacks).toHaveLength(0);
    expect(g.nations[2].troops).toBe(1000 - neutralCost);
  });

  it('mountains are crossed more slowly than plains', () => {
    const run = (terrain: string) => {
      const g = makeTestGame({ map: ['#' + terrain.repeat(14)], owners: ['a' + '.'.repeat(14)], nations: [{ troops: 1000 }] });
      applyCommand(g, attack(1, 1, 1));
      steps(g, 10);
      return g.nations[1].tiles - 1;
    };
    // a one-tile front earns 1 speed point a tick; a plains tile uses 1, a mountain 2.5 (debt carries over)
    expect(run('#')).toBe(10);
    expect(run('M')).toBe(4);
    expect(run('^')).toBe(7);
  });

  it('a wider front takes more tiles per tick, up to maxTilesPerTick', () => {
    const firstTick = (rows: number) => {
      const g = makeTestGame({
        map: Array.from({ length: rows }, () => '###'),
        owners: Array.from({ length: rows }, () => 'a..'),
        nations: [{ troops: 1e6 }],
      });
      applyCommand(g, attack(1, 1, 1));
      stepAttacks(g);
      return g.nations[1].tiles - rows;
    };
    expect(firstTick(1)).toBe(1);
    expect(firstTick(10)).toBe(Math.ceil(10 * frontFraction));
    expect(firstTick(400)).toBe(maxTilesPerTick);
  });

  it('a straight front keeps the speed of its width, tick after tick', () => {
    const rows = 40;
    const width = 40;
    const perTick = Math.min(maxTilesPerTick, Math.max(minTilesPerTick, rows * frontFraction));
    const gains = (target: 'b' | '.') => {
      const g = makeTestGame({
        map: Array.from({ length: rows }, () => '#'.repeat(width)),
        owners: Array.from({ length: rows }, () => 'a' + target.repeat(width - 1)),
        nations: target === 'b' ? [{ troops: 1e7 }, { troops: 1000 }] : [{ troops: 1e7 }],
      });
      expect(applyCommand(g, attack(1, 1, 1)).ok).toBe(true);
      const gained: number[] = [];
      for (let i = 0; i < 30; i++) {
        const before = g.nations[1].tiles;
        stepAttacks(g);
        gained.push(g.nations[1].tiles - before);
        // the speed comes from the distinct live front, and superseded heap entries don't pile up
        const { queued, frontier } = g.attacks[0];
        expect(queued.size).toBeGreaterThanOrEqual(rows);
        expect(queued.size).toBeLessThanOrEqual(rows * 1.2);
        expect(frontier.size).toBeLessThanOrEqual(3 * queued.size);
      }
      return gained;
    };
    for (const target of ['.', 'b'] as const) {
      const gained = gains(target);
      // the front stays 40 tiles wide (give or take a ragged edge), so every tick takes about 40 × frontFraction
      for (const n of gained) {
        expect(n).toBeGreaterThanOrEqual(perTick);
        expect(n).toBeLessThanOrEqual(perTick * 1.2);
      }
      expect(gained.slice(10).reduce((s, n) => s + n, 0)).toBeLessThanOrEqual(20 * perTick * 1.1);
    }
  });

  it('is deterministic for a seed', () => {
    const play = () => {
      const g = makeTestGame({
        map: ['##^^####MM##', '#####^^#####', '##MM########', '############'],
        owners: ['a..........b', '............', '............', '............'],
        nations: [{ troops: 1000 }, { troops: 1000 }],
        seed: 7,
      });
      applyCommand(g, attack(1, 1, 0.4));
      applyCommand(g, attack(2, 10, 0.4));
      steps(g, 15);
      applyCommand(g, attack(1, 6, 0.5));
      steps(g, 40);
      return g.owner;
    };
    expect(play()).toEqual(play());
  });
});

describe('cancelAttacksBetween', () => {
  it('returns the troops of both directions and leaves other attacks alone', () => {
    const g = makeTestGame({
      map: ['######'], owners: ['abbc..'], nations: [{ troops: 1000 }, { troops: 1000 }, { troops: 1000 }],
    });
    startAttack(g, 1, 2, 300);
    startAttack(g, 3, 2, 200);
    startAttack(g, 3, 0, 100);
    cancelAttacksBetween(g, 2, 1);
    expect(g.attacks.map((a) => [a.attacker, a.target])).toEqual([[3, 2], [3, 0]]);
    expect(g.nations[1].troops).toBe(1000);
    cancelAttacksBetween(g, 2, 3);
    expect(g.attacks.map((a) => [a.attacker, a.target])).toEqual([[3, 0]]);
    expect(g.nations[3].troops).toBe(900);
  });
});

describe('landTroops', () => {
  const events = (g: Game): GameEvent[] => g.drainEvents();

  it('landTroops on own tile returns troops; on enemy coast starts an attack', () => {
    // a at 0-1, water at 2, b at 3-6 with density 100
    const g = makeTestGame({ map: ['##.####'], owners: ['aa.bbbb'], nations: [{ troops: 1000 }, { troops: 400 }] });
    landTroops(g, 1, 0, 250);
    expect(g.nations[1].troops).toBe(1250);
    expect(g.owner[0]).toBe(1);
    expect(events(g)).toEqual([]);

    const cost = tileCaptureCost(g, 1, 3);
    expect(cost).toBeCloseTo(baseCost + 100 * densityFactor, 10);
    landTroops(g, 1, 3, 500);
    expect(g.owner[3]).toBe(1);
    expect(g.nations[2].troops).toBeCloseTo(300, 10);
    expect(g.nations[1].troops).toBe(1250);
    expect(g.relations.get(1, 2)).toBe('war');
    expect(g.attacks).toHaveLength(1);
    expect(g.attacks[0].attacker).toBe(1);
    expect(g.attacks[0].target).toBe(2);
    expect(g.attacks[0].troops).toBeCloseTo(500 - cost, 10);
    expect(events(g)).toEqual([
      { type: 'relation', a: 1, b: 2, relation: 'war' },
      { type: 'landed', nation: 1, tile: 3, troops: 500 },
      { type: 'attackStarted', attacker: 1, target: 2, troops: 500 - cost },
    ]);
    steps(g, 10);
    expect(ownedBy(g, 1)).toEqual([0, 1, 3, 4, 5, 6]);
    expect(g.nations[2].alive).toBe(false);
  });

  it('returns troops on an allied tile', () => {
    const g = makeTestGame({ map: ['#.#'], owners: ['a.b'], nations: [{ troops: 0 }, { troops: 100 }] });
    g.relations.set(1, 2, 'allied');
    landTroops(g, 1, 2, 300);
    expect(g.nations[1].troops).toBe(300);
    expect(g.owner[2]).toBe(2);
    expect(g.relations.get(1, 2)).toBe('allied');
    expect(events(g)).toEqual([]);
  });

  it('loses the troops when they cannot pay for the beach', () => {
    const g = makeTestGame({ map: ['#.##'], owners: ['a.bb'], nations: [{ troops: 0 }, { troops: 200 }] });
    landTroops(g, 1, 2, 50);
    expect(g.owner[2]).toBe(2);
    expect(g.nations[1].troops).toBe(0);
    expect(g.nations[2].troops).toBe(200);
    expect(g.attacks).toHaveLength(0);
  });

  it('takes an unowned beach and spreads inland from it', () => {
    const g = makeTestGame({ map: ['#.####'], owners: ['a.....'], nations: [{ troops: 0 }] });
    landTroops(g, 1, 2, 100);
    expect(g.owner[2]).toBe(1);
    expect(g.attacks).toHaveLength(1);
    expect(g.attacks[0]).toMatchObject({ attacker: 1, target: 0, troops: 100 - neutralCost });
    steps(g, 10);
    expect(ownedBy(g, 1)).toEqual([0, 2, 3, 4, 5]);
    expect(g.nations[1].troops).toBeCloseTo(100 - 4 * neutralCost, 10);
  });

  it('a landing that takes the last tile eliminates the owner and the rest comes home', () => {
    const g = makeTestGame({ map: ['#.#'], owners: ['a.b'], nations: [{ troops: 0 }, { troops: 0 }] });
    landTroops(g, 1, 2, 100);
    expect(g.owner[2]).toBe(1);
    expect(g.nations[2].alive).toBe(false);
    expect(g.attacks).toHaveLength(0);
    expect(g.nations[1].troops).toBeCloseTo(100 - baseCost, 10);
    expect(events(g)).toContainEqual({ type: 'eliminated', nation: 2, by: 1 });
  });

  it('merges a landing into the attack already under way', () => {
    // a at 0 attacks b by land; then lands at b's far end (7) and both fronts close in
    const g = makeTestGame({ map: ['###.####'], owners: ['abb.bbbb'], nations: [{ troops: 1000 }, { troops: 0 }] });
    expect(applyCommand(g, attack(1, 1, 0.5)).ok).toBe(true);
    landTroops(g, 1, 7, 100);
    expect(g.attacks).toHaveLength(1);
    expect(g.attacks[0].troops).toBe(500 + 100 - baseCost);
    steps(g, 20);
    expect(ownedBy(g, 1)).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });
});
