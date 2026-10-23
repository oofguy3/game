import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../shared/rules';
import type { GameEvent } from '../shared/types';
import type { GameUpdate, InitPayload, NationSnap } from '../worker/protocol';
import { ClientState } from './state';

const init: InitPayload = {
  width: 4,
  height: 2,
  terrain: new Uint8Array(8).fill(1),
  playerId: 1,
  rules: { ...DEFAULT_RULES },
  nations: [
    { id: 1, name: 'You', color: 0x3b82f6, isPlayer: true, team: 0 },
    { id: 2, name: 'Varlonia', color: 0xd31717, isPlayer: false, team: 0 },
  ],
  spawnEndsAt: 100,
  look: { latitude: { top: 72, bottom: -72 }, seed: 1, dryBands: false },
};

const snap = (id: number, over: Partial<NationSnap> = {}): NationSnap => ({
  id, troops: 100, maxTroops: 1000, gold: 5, income: 1, tiles: 2, alive: true, spawned: true,
  relationToPlayer: 'neutral', embargoed: false, allies: [], attackingPlayer: 0, askReadyIn: 0, label: null,
  stats: { peakTiles: 2, tilesCaptured: 0, buildingsBuilt: 0, goldEarned: 0 }, ...over,
});

const update = (over: Partial<GameUpdate> = {}): GameUpdate => ({
  tick: 1, phase: 'playing', changedTiles: new Uint32Array(), changedOwners: new Uint16Array(),
  nations: [snap(1), snap(2)], buildings: null, units: [], events: [], requests: [], result: null, fronts: [], ...over,
});

describe('ClientState', () => {
  it('counts the tiles the player gained and lists the tiles they lost in each update', () => {
    const s = new ClientState();
    s.applyInit(init);
    s.applyUpdate(update({ changedTiles: new Uint32Array([0]), changedOwners: new Uint16Array([1]) }));
    expect(s.gained).toBe(1);
    expect(s.lost).toEqual([]);
    s.applyUpdate(update({ changedTiles: new Uint32Array([0, 1, 2]), changedOwners: new Uint16Array([2, 1, 1]) }));
    expect(s.gained).toBe(2);
    expect(s.lost).toEqual([0]);
    s.applyUpdate(update());
    expect(s.gained).toBe(0);
    expect(s.lost).toEqual([]);
  });

  it('does not count land the player gives up by moving their spawn as lost', () => {
    const s = new ClientState();
    s.applyInit(init);
    s.applyUpdate(update({ phase: 'spawn', changedTiles: new Uint32Array([0, 1]), changedOwners: new Uint16Array([1, 1]) }));
    // the old spot goes back to nobody, the new one becomes the player's
    s.applyUpdate(update({ phase: 'spawn', changedTiles: new Uint32Array([0, 1, 6, 7]), changedOwners: new Uint16Array([0, 0, 1, 1]) }));
    expect(s.lost).toEqual([]);
    expect(s.gained).toBe(2);
  });

  it('keeps the fronts of the latest update', () => {
    const s = new ClientState();
    s.applyInit(init);
    s.applyUpdate(update({ fronts: [[2, 3]] }));
    expect(s.fronts).toEqual([[2, 3]]);
    s.applyUpdate(update());
    expect(s.fronts).toEqual([]);
  });

  it('applyUpdate writes owners and nation snaps', () => {
    const s = new ClientState();
    s.applyInit(init);
    expect(s.owner).toHaveLength(8);
    s.applyUpdate(update({ tick: 7, changedTiles: new Uint32Array([0, 5]), changedOwners: new Uint16Array([1, 2]) }));
    expect([...s.owner]).toEqual([1, 0, 0, 0, 0, 2, 0, 0]);
    expect(s.tick).toBe(7);
    expect(s.phase).toBe('playing');
    expect(s.player?.id).toBe(1);
    expect(s.nations.get(2)?.troops).toBe(100);
    expect(s.drainChangedTiles()).toEqual([0, 5]);
    expect(s.drainChangedTiles()).toEqual([]);
  });

  it('keeps the buildings when the update says they are unchanged', () => {
    const s = new ClientState();
    s.applyInit(init);
    const city = { id: 9, type: 'city' as const, owner: 1, tile: 0, underConstruction: false };
    s.applyUpdate(update({ buildings: [city] }));
    s.applyUpdate(update({ buildings: null }));
    expect(s.buildings).toEqual([city]);
    s.applyUpdate(update({ buildings: [] }));
    expect(s.buildings).toEqual([]);
  });

  it('playerDefeated is true once the player is not alive', () => {
    const s = new ClientState();
    s.applyInit(init);
    s.applyUpdate(update());
    expect(s.playerDefeated).toBe(false);
    s.applyUpdate(update({ nations: [snap(1, { alive: false, tiles: 0 }), snap(2)] }));
    expect(s.playerDefeated).toBe(true);
    expect(s.result).toBeNull();
  });

  it('feeds only the events that concern the player, keeping the last 50', () => {
    const s = new ClientState();
    s.applyInit(init);
    const mine: GameEvent = { type: 'attackStarted', attacker: 2, target: 1, troops: 50 };
    const others: GameEvent = { type: 'attackStarted', attacker: 2, target: 3, troops: 50 };
    const everyone: GameEvent = { type: 'eliminated', nation: 3, by: 2 };
    const aidToMe: GameEvent = { type: 'aidSent', from: 2, to: 1, gold: 0, troops: 400 };
    const aidFromMe: GameEvent = { type: 'aidSent', from: 1, to: 2, gold: 100, troops: 0 };
    const aidElsewhere: GameEvent = { type: 'aidSent', from: 2, to: 3, gold: 100, troops: 0 };
    const forMe: GameEvent = { ...others, support: { ally: 1, kind: 'join' } };
    const forOthers: GameEvent = { ...others, support: { ally: 4, kind: 'defend' } };
    const myCapital: GameEvent = { type: 'capitalThreat', nation: 1, tile: 3 };
    const theirCapital: GameEvent = { type: 'capitalThreat', nation: 2, tile: 5 };
    const fell: GameEvent = { type: 'capitalFell', nation: 3, by: 2, tiles: 40 };
    const events = [
      mine, others, everyone, aidToMe, aidFromMe, aidElsewhere, forMe, forOthers, myCapital, theirCapital, fell,
    ];
    s.applyUpdate(update({ events }));
    expect(s.feed).toEqual([mine, everyone, aidToMe, aidFromMe, forMe, myCapital, fell]);
    s.applyUpdate(update({ events: Array.from({ length: 60 }, () => mine) }));
    expect(s.feed).toHaveLength(50);
  });

  it('starts over on a new init', () => {
    const s = new ClientState();
    s.applyInit(init);
    s.applyUpdate(update({ changedTiles: new Uint32Array([0]), changedOwners: new Uint16Array([1]) }));
    s.applyInit(init);
    expect([...s.owner]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.nations.size).toBe(0);
    expect(s.feed).toEqual([]);
  });
});

describe('ClientState.onEvents', () => {
  it('hands every event of an update to the listener, not only the player’s', () => {
    const s = new ClientState();
    s.applyInit(init);
    const seen: GameEvent[] = [];
    s.onEvents = (events) => seen.push(...events);
    const events: GameEvent[] = [{ type: 'bombed', by: 2, owner: 3, tile: 1 }, { type: 'spawned', nation: 2, tile: 0 }];
    s.applyUpdate(update({ events }));
    expect(seen).toEqual(events);
  });
});
