import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../shared/types';
import type { BuildingSnap, UnitSnap } from '../../worker/protocol';
import { SoundDirector } from './director';
import type { UpdateFacts } from './director';

const ME = 1;
const facts = (over: Partial<UpdateFacts> = {}): UpdateFacts => ({ events: [], gained: 0, units: [], buildings: null, ...over });
const unit = (id: number, type: UnitSnap['type'], owner = ME): UnitSnap => ({ id, type, owner, x: 0, y: 0, troops: 0 });
const building = (id: number, owner = ME): BuildingSnap => ({ id, type: 'city', owner, tile: 0, underConstruction: true });

describe('SoundDirector', () => {
  it.each<[string, GameEvent]>([
    ['built', { type: 'buildingDone', nation: ME, building: 'city', tile: 0 }],
    ['send', { type: 'attackStarted', attacker: ME, target: 2, troops: 10 }],
    ['send', { type: 'attackStarted', attacker: ME, target: 0, troops: 10 }],
    ['warning', { type: 'attackStarted', attacker: 2, target: ME, troops: 10 }],
    ['boom', { type: 'bombed', by: ME, owner: 2, tile: 0 }],
    ['boom', { type: 'bombed', by: 2, owner: ME, tile: 0 }],
    ['landing', { type: 'landed', nation: ME, tile: 0, troops: 5 }],
    ['refused', { type: 'rejected', nation: ME, reason: 'x' }],
    ['radar', { type: 'radarWarning', nation: ME, from: 2, unit: 'bomber', tile: 0 }],
    ['offer', { type: 'request', request: { id: 1, kind: 'alliance', from: 2, to: ME, expiresAt: 9 } }],
    ['accepted', { type: 'requestResolved', requestId: 1, kind: 'alliance', from: ME, to: 2, accepted: true }],
    ['declined', { type: 'requestResolved', requestId: 1, kind: 'alliance', from: ME, to: 2, accepted: false }],
    ['betrayal', { type: 'betrayal', betrayer: 2, victim: ME }],
    ['lost', { type: 'buildingCaptured', from: ME, to: 2, building: 'port', tile: 0 }],
    ['lost', { type: 'buildingDestroyed', owner: ME, by: 2, building: 'port', tile: 0 }],
    ['warStart', { type: 'phase', phase: 'playing' }],
    ['knockout', { type: 'eliminated', nation: 3, by: ME }],
    ['victory', { type: 'gameOver', result: { winners: [ME], reason: 'landShare' } }],
    ['defeat', { type: 'gameOver', result: { winners: [2], reason: 'landShare' } }],
    ['defeat', { type: 'eliminated', nation: ME, by: 2 }],
  ])('%s for %o', (sound, event) => {
    expect(new SoundDirector(ME).sounds(facts({ events: [event] }))).toEqual([sound]);
  });

  it("keeps quiet about other nations' business", () => {
    const events: GameEvent[] = [
      { type: 'attackStarted', attacker: 2, target: 3, troops: 10 },
      { type: 'bombed', by: 2, owner: 3, tile: 0 },
      { type: 'buildingDone', nation: 2, building: 'city', tile: 0 },
      { type: 'request', request: { id: 1, kind: 'peace', from: 2, to: 3, expiresAt: 9 } },
      { type: 'requestResolved', requestId: 1, kind: 'peace', from: 2, to: ME, accepted: true },
      { type: 'betrayal', betrayer: 2, victim: 3 },
      { type: 'eliminated', nation: 3, by: 2 },
      { type: 'phase', phase: 'ended' },
    ];
    expect(new SoundDirector(ME).sounds(facts({ events, units: [unit(5, 'troopBoat', 2)], buildings: [building(6, 2)] }))).toEqual([]);
  });

  it('thuds when the land grew', () => {
    expect(new SoundDirector(ME).sounds(facts({ gained: 3 }))).toEqual(['thud']);
  });

  it('horn for a new troop boat or warship, jet for a new bomber, paratroop plane or fighter, nothing for trade', () => {
    const d = new SoundDirector(ME);
    expect(d.sounds(facts({ units: [unit(1, 'troopBoat')] }))).toEqual(['horn']);
    expect(d.sounds(facts({ units: [unit(1, 'troopBoat'), unit(2, 'warship')] }))).toEqual(['horn']);
    expect(d.sounds(facts({ units: [unit(3, 'bomber')] }))).toEqual(['jet']);
    expect(d.sounds(facts({ units: [unit(4, 'paraPlane'), unit(5, 'fighter')] }))).toEqual(['jet']);
    expect(d.sounds(facts({ units: [unit(6, 'tradeShip'), unit(7, 'tradePlane')] }))).toEqual([]);
    expect(d.sounds(facts({ units: [unit(1, 'troopBoat'), unit(3, 'bomber')] }))).toEqual([]);
  });

  it('places a new building of mine once; updates without building changes say nothing', () => {
    const d = new SoundDirector(ME);
    expect(d.sounds(facts({ buildings: [building(9)] }))).toEqual(['place']);
    expect(d.sounds(facts({ buildings: null }))).toEqual([]);
    expect(d.sounds(facts({ buildings: [building(9)] }))).toEqual([]);
  });

  it('plays victory or defeat at most once per match', () => {
    const d = new SoundDirector(ME);
    expect(d.sounds(facts({ events: [{ type: 'eliminated', nation: ME, by: 2 }] }))).toEqual(['defeat']);
    expect(d.sounds(facts({ events: [{ type: 'gameOver', result: { winners: [2], reason: 'landShare' } }] }))).toEqual([]);
  });

  it('lists each sound once, in a fixed order', () => {
    const events: GameEvent[] = [
      { type: 'rejected', nation: ME, reason: 'x' },
      { type: 'buildingDone', nation: ME, building: 'city', tile: 0 },
      { type: 'buildingDone', nation: ME, building: 'bank', tile: 1 },
    ];
    expect(new SoundDirector(ME).sounds(facts({ events, gained: 1 }))).toEqual(['built', 'thud', 'refused']);
  });
});
