import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import type { BuildingType, Command, GameEvent, NationId, TileIndex } from '../../shared/types';
import { applyCommand } from '../core/commands';
import type { Game } from '../core/game';
import { tileOf } from '../map/grid';
import { makeTestGame } from '../testing/fixtures';
import { breakAlliance, createRequest, respond, stepDiplomacy } from './diplomacy';
import { stepUnits } from './units';

/** A row of plains: a, b, c and d side by side, 1000 troops each. */
function four(): Game {
  return makeTestGame({
    map: ['################'],
    owners: ['aaaabbbbccccdddd'],
    nations: [{ troops: 1000 }, { troops: 1000 }, { troops: 1000 }, { troops: 1000 }],
  });
}

const ok = (g: Game, cmd: Command): void => expect(applyCommand(g, cmd)).toEqual({ ok: true });

function reject(g: Game, cmd: Command, reason: string): void {
  expect(applyCommand(g, cmd)).toEqual({ ok: false, reason });
  expect(g.drainEvents()).toEqual([{ type: 'rejected', nation: cmd.nation, reason }]);
}

/** The id of the newest pending request. */
const lastRequest = (g: Game): number => Math.max(...g.requests.keys());

describe('alliances', () => {
  it('accepted alliance cancels attacks between the pair and blocks new ones', () => {
    const g = four();
    ok(g, { type: 'attack', nation: 1, tile: tileOf(g.map, 4, 0), ratio: 0.5 });
    ok(g, { type: 'attack', nation: 2, tile: tileOf(g.map, 3, 0), ratio: 0.2 });
    ok(g, { type: 'attack', nation: 2, tile: tileOf(g.map, 8, 0), ratio: 0.2 });
    expect(g.relations.get(1, 2)).toBe('war');
    g.drainEvents();
    ok(g, { type: 'proposeAlliance', nation: 1, to: 2 });
    const id = lastRequest(g);
    expect(g.drainEvents()).toEqual([{ type: 'request', request: g.requests.get(id) }]);
    expect(g.requests.get(id)).toEqual({ id, kind: 'alliance', from: 1, to: 2, expiresAt: g.tick + CONFIG.diplomacy.requestTtlTicks });
    const troops = g.nations[1].troops + g.nations[2].troops;
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: true });
    expect(g.relations.get(1, 2)).toBe('allied');
    // the attacks between them are over and their troops home; b's attack on c goes on
    expect(g.attacks.map((a) => [a.attacker, a.target])).toEqual([[2, 3]]);
    const away = g.attacks[0].troops;
    expect(g.nations[1].troops + g.nations[2].troops).toBeGreaterThan(troops);
    expect(g.nations[1].troops + g.nations[2].troops + away).toBeGreaterThan(troops);
    const events = g.drainEvents();
    expect(events).toContainEqual({ type: 'relation', a: 1, b: 2, relation: 'allied' });
    expect(events).toContainEqual({ type: 'requestResolved', requestId: id, kind: 'alliance', from: 1, to: 2, accepted: true });
    expect(g.requests.size).toBe(0);
    // allies can't attack each other, by land or air
    reject(g, { type: 'attack', nation: 1, tile: tileOf(g.map, 4, 0), ratio: 0.5 }, 'allied');
    reject(g, { type: 'attack', nation: 2, tile: tileOf(g.map, 3, 0), ratio: 0.5 }, 'allied');
    reject(g, { type: 'proposeAlliance', nation: 2, to: 1 }, 'already allied');
  });

  it('a declined proposal changes nothing', () => {
    const g = four();
    ok(g, { type: 'proposeAlliance', nation: 1, to: 2 });
    const id = lastRequest(g);
    g.drainEvents();
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: false });
    expect(g.relations.get(1, 2)).toBe('neutral');
    expect(g.drainEvents()).toEqual([{ type: 'requestResolved', requestId: id, kind: 'alliance', from: 1, to: 2, accepted: false }]);
  });

  it("betrayal lowers every other nation's trust in the betrayer", () => {
    const g = four();
    g.relations.set(1, 2, 'allied');
    g.relations.setTrust(3, 1, 0.9);
    g.relations.setTrust(4, 1, 0.3);
    g.relations.setTrust(2, 1, 0.8);
    g.relations.setTrust(1, 3, 0.7);
    reject(g, { type: 'breakAlliance', nation: 1, with: 3 }, 'not allied');
    ok(g, { type: 'breakAlliance', nation: 1, with: 2 });
    expect(g.relations.get(1, 2)).toBe('neutral');
    expect(g.drainEvents()).toEqual([
      { type: 'relation', a: 1, b: 2, relation: 'neutral' },
      { type: 'betrayal', betrayer: 1, victim: 2 },
    ]);
    const penalty = CONFIG.diplomacy.betrayalTrustPenalty;
    expect(g.relations.trust(3, 1)).toBeCloseTo(0.9 - penalty, 6);
    expect(g.relations.trust(4, 1)).toBe(0); // never below 0
    expect(g.relations.trust(2, 1)).toBe(0); // the victim trusts the betrayer no more
    // the betrayer's own trust in others is untouched
    expect(g.relations.trust(1, 3)).toBeCloseTo(0.7, 6);
    // breaking an alliance is not a war: attacking the old ally afterwards is
    ok(g, { type: 'attack', nation: 1, tile: tileOf(g.map, 4, 0), ratio: 0.5 });
    expect(g.relations.get(1, 2)).toBe('war');
    expect(breakAlliance(g, 1, 1)).toEqual({ ok: false, reason: 'yourself' });
  });
});

describe('alliances and planes in the air', () => {
  it('a bomber already in the air spares a nation that has since become an ally', () => {
    const map = Array.from({ length: 9 }, () => '#'.repeat(60));
    const owners = Array.from({ length: 9 }, () => 'a'.repeat(30) + 'b'.repeat(30));
    const g = makeTestGame({ map, owners, nations: [{ troops: 5000, gold: 10_000 }, { troops: 5000 }] });
    g.buildings.add({ id: g.nextId(), type: 'airport', owner: 1, tile: tileOf(g.map, 5, 4), ticksLeft: 0, cooldown: 0 });
    const city = tileOf(g.map, 50, 4);
    g.buildings.add({ id: g.nextId(), type: 'city', owner: 2, tile: city, ticksLeft: 0, cooldown: 0 });
    ok(g, { type: 'bomb', nation: 1, tile: city });
    ok(g, { type: 'proposePeace', nation: 1, to: 2 });
    ok(g, { type: 'respond', nation: 2, requestId: lastRequest(g), accept: true });
    ok(g, { type: 'proposeAlliance', nation: 1, to: 2 });
    ok(g, { type: 'respond', nation: 2, requestId: lastRequest(g), accept: true });
    const troops = g.nations[2].troops;
    for (let i = 0; i < 60; i++) stepUnits(g);
    expect(g.buildings.at(city)).toBeDefined();
    expect(g.nations[2].troops).toBe(troops);
  });
});

describe('peace', () => {
  it('peace ends a war', () => {
    const g = four();
    reject(g, { type: 'proposePeace', nation: 1, to: 2 }, 'not at war');
    ok(g, { type: 'attack', nation: 1, tile: tileOf(g.map, 4, 0), ratio: 0.5 });
    ok(g, { type: 'proposePeace', nation: 2, to: 1 });
    const id = lastRequest(g);
    g.drainEvents();
    ok(g, { type: 'respond', nation: 1, requestId: id, accept: true });
    expect(g.relations.get(1, 2)).toBe('neutral');
    expect(g.attacks).toEqual([]);
    const events = g.drainEvents();
    expect(events).toContainEqual({ type: 'relation', a: 2, b: 1, relation: 'neutral' });
    expect(events).toContainEqual({ type: 'requestResolved', requestId: id, kind: 'peace', from: 2, to: 1, accepted: true });
  });

  it('accepting peace after the war already ended changes nothing', () => {
    const g = four();
    g.relations.set(1, 2, 'war');
    ok(g, { type: 'proposePeace', nation: 1, to: 2 });
    const id = lastRequest(g);
    g.relations.set(1, 2, 'allied');
    ok(g, { type: 'respond', nation: 2, requestId: id, accept: true });
    expect(g.relations.get(1, 2)).toBe('allied');
  });
});

describe('requests', () => {
  it('requests expire and only the addressee can respond', () => {
    const g = four();
    ok(g, { type: 'proposeAlliance', nation: 1, to: 2 });
    const id = lastRequest(g);
    g.drainEvents();
    reject(g, { type: 'respond', nation: 3, requestId: id, accept: true }, 'not addressed to you');
    reject(g, { type: 'respond', nation: 1, requestId: id, accept: true }, 'not addressed to you');
    reject(g, { type: 'respond', nation: 2, requestId: 999, accept: true }, 'no such request');
    reject(g, { type: 'proposeAlliance', nation: 1, to: 2 }, 'already proposed');
    reject(g, { type: 'proposeAlliance', nation: 1, to: 1 }, 'yourself');
    reject(g, { type: 'proposeAlliance', nation: 1, to: 9 }, 'unknown nation');
    g.nations[4].alive = false;
    reject(g, { type: 'proposeAlliance', nation: 1, to: 4 }, 'eliminated');
    // a different kind of request between the same pair is fine
    g.relations.set(1, 2, 'war');
    ok(g, { type: 'proposePeace', nation: 1, to: 2 });
    g.drainEvents();
    // both expire unanswered
    const events: GameEvent[] = [];
    for (let i = 0; i < CONFIG.diplomacy.requestTtlTicks; i++) {
      g.tick++;
      stepDiplomacy(g);
      events.push(...g.drainEvents());
    }
    expect(g.requests.size).toBe(0);
    expect(events.filter((e) => e.type === 'requestResolved')).toEqual([
      { type: 'requestResolved', requestId: id, kind: 'alliance', from: 1, to: 2, accepted: false },
      expect.objectContaining({ kind: 'peace', accepted: false }),
    ]);
    reject(g, { type: 'respond', nation: 2, requestId: id, accept: true }, 'no such request');
    expect(g.relations.get(1, 2)).toBe('war');
  });

  it('requests to or from a nation that dies are dropped', () => {
    const g = four();
    expect(createRequest(g, 'alliance', 1, 2)).toEqual({ ok: true });
    const id = lastRequest(g);
    g.drainEvents();
    g.nations[1].alive = false;
    stepDiplomacy(g);
    expect(g.requests.size).toBe(0);
    expect(g.drainEvents()).toEqual([{ type: 'requestResolved', requestId: id, kind: 'alliance', from: 1, to: 2, accepted: false }]);
    expect(respond(g, 2, id, true)).toEqual({ ok: false, reason: 'no such request' });
  });

  it('trust drifts back toward the default', () => {
    const g = four();
    g.relations.setTrust(3, 1, 0);
    g.relations.setTrust(2, 4, 1);
    for (let i = 0; i < 100; i++) stepDiplomacy(g);
    const step = CONFIG.diplomacy.trustRecoveryPerTick;
    expect(g.relations.trust(3, 1)).toBeCloseTo(100 * step, 5);
    expect(g.relations.trust(2, 4)).toBeCloseTo(1 - 100 * step, 5);
    expect(g.relations.trust(1, 2)).toBeCloseTo(CONFIG.diplomacy.defaultTrust, 6);
    // and never overshoots
    g.relations.setTrust(3, 1, CONFIG.diplomacy.defaultTrust - step / 2);
    stepDiplomacy(g);
    expect(g.relations.trust(3, 1)).toBeCloseTo(CONFIG.diplomacy.defaultTrust, 6);
  });
});

describe('embargo', () => {
  /** a and b on either shore of a sea, each with a port and an airport. */
  function traders(): Game {
    const map = Array.from({ length: 7 }, () => '##' + '.'.repeat(76) + '##');
    const owners = Array.from({ length: 7 }, () => 'aa' + '.'.repeat(76) + 'bb');
    const g = makeTestGame({ map, owners, nations: [{}, {}] });
    const place = (owner: NationId, type: BuildingType, tile: TileIndex): void => {
      g.buildings.add({ id: g.nextId(), type, owner, tile, ticksLeft: 0, cooldown: 0 });
      g.nations[owner].buildingCounts[type]++;
    };
    place(1, 'port', tileOf(g.map, 1, 1));
    place(2, 'port', tileOf(g.map, 78, 1));
    place(1, 'airport', tileOf(g.map, 0, 5));
    place(2, 'airport', tileOf(g.map, 79, 5));
    return g;
  }

  const traffic = (g: Game, ticks: number): { units: number; trades: number } => {
    let units = 0;
    let trades = 0;
    for (let i = 0; i < ticks; i++) {
      stepUnits(g);
      units = Math.max(units, [...g.units.values()].filter((u) => u.type === 'tradeShip' || u.type === 'tradePlane').length);
      trades += g.drainEvents().filter((e) => e.type === 'trade').length;
    }
    return { units, trades };
  };

  it('embargo stops new trade ships and planes', () => {
    const g = traders();
    ok(g, { type: 'embargo', nation: 2, with: 1, on: true });
    expect(g.relations.embargoed(1, 2)).toBe(true);
    expect(traffic(g, 300)).toEqual({ units: 0, trades: 0 });
    ok(g, { type: 'embargo', nation: 2, with: 1, on: false });
    const after = traffic(g, 300);
    expect(after.units).toBeGreaterThan(0);
    expect(after.trades).toBeGreaterThan(0);
    reject(g, { type: 'embargo', nation: 2, with: 2, on: true }, 'yourself');
    reject(g, { type: 'embargo', nation: 2, with: 0, on: true }, 'unknown nation');
  });
});

describe('alliance victory', () => {
  it('two allied survivors trigger alliance victory', () => {
    const g = makeTestGame({
      map: ['##########'],
      owners: ['aaaa.bbbb.'],
      nations: [{}, {}, { alive: false }],
      victory: true,
    });
    g.step();
    expect(g.result).toBeNull();
    g.queue({ type: 'proposeAlliance', nation: 1, to: 2 });
    g.step();
    g.queue({ type: 'respond', nation: 2, requestId: lastRequest(g), accept: true });
    g.step();
    expect(g.result).toEqual({ winners: [1, 2], reason: 'alliance' });
    expect(g.phase).toBe('ended');
  });
});

describe('making peace with units in flight', () => {
  it('calls back boats, paratroopers and bombers heading for the other side', () => {
    const map = ['......................', '.####............####.', '.####............####.', '.####............####.', '......................'];
    const owners = ['.'.repeat(22), '.aaaa............bbbb.', '.aaaa............bbbb.', '.aaaa............bbbb.', '.'.repeat(22)];
    const g = makeTestGame({ map, owners, nations: [{ troops: 10_000, gold: 100_000 }, { troops: 2_000 }] });
    g.buildings.add({ id: g.nextId(), type: 'airport', owner: 1, tile: tileOf(g.map, 2, 2), ticksLeft: 0, cooldown: 0 });
    g.buildings.add({ id: g.nextId(), type: 'airport', owner: 1, tile: tileOf(g.map, 2, 1), ticksLeft: 0, cooldown: 0 });
    g.buildings.add({ id: g.nextId(), type: 'city', owner: 2, tile: tileOf(g.map, 18, 2), ticksLeft: 0, cooldown: 0 });
    ok(g, { type: 'boat', nation: 1, tile: tileOf(g.map, 17, 1), ratio: 0.1 });
    ok(g, { type: 'paradrop', nation: 1, tile: tileOf(g.map, 19, 2), ratio: 0.1 });
    ok(g, { type: 'bomb', nation: 1, tile: tileOf(g.map, 18, 2) });
    const troops = g.nations[1].troops;
    const away = [...g.units.values()].filter((u) => u.type === 'troopBoat' || u.type === 'paraPlane').reduce((s, u) => s + u.troops, 0);
    expect(away).toBeGreaterThan(0);
    ok(g, { type: 'proposePeace', nation: 2, to: 1 });
    ok(g, { type: 'respond', nation: 1, requestId: lastRequest(g), accept: true });
    expect([...g.units.values()].filter((u) => u.type === 'troopBoat' || u.type === 'paraPlane')).toEqual([]);
    expect(g.nations[1].troops).toBeCloseTo(troops + away, 6);
    g.drainEvents();
    const events: GameEvent[] = [];
    for (let i = 0; i < 100; i++) {
      stepUnits(g);
      events.push(...g.drainEvents());
    }
    expect(g.relations.get(1, 2)).toBe('neutral');
    expect(events.filter((e) => e.type === 'relation' || e.type === 'bombed' || e.type === 'landed')).toEqual([]);
    expect(g.buildings.at(tileOf(g.map, 18, 2))).toBeDefined();
    expect(g.nations[2].tiles).toBe(12);
    // the bomber went home
    expect([...g.units.values()].filter((u) => u.type === 'bomber')).toEqual([]);
  });
});
