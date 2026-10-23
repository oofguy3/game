import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../shared/types';
import { describeEvent } from './eventText';

const names = new Map([[1, 'You'], [2, 'Varlonia'], [3, 'Kestria']]);
const say = (e: GameEvent): string | null => describeEvent(e, names, 1);

describe('describeEvent', () => {
  it.each<[GameEvent, string]>([
    [{ type: 'attackStarted', attacker: 2, target: 1, troops: 300 }, 'Varlonia attacked you'],
    [{ type: 'attackStarted', attacker: 1, target: 3, troops: 300 }, 'You attacked Kestria'],
    [{ type: 'buildingDone', nation: 1, building: 'city', tile: 0 }, 'City complete'],
    [{ type: 'buildingDone', nation: 1, building: 'defensePost', tile: 0 }, 'Defense post complete'],
    [{ type: 'landed', nation: 1, tile: 0, troops: 50 }, 'Your troops landed'],
    [{ type: 'bombed', by: 2, owner: 1, tile: 0 }, 'Varlonia bombed you'],
    [{ type: 'bombed', by: 1, owner: 3, tile: 0 }, 'Your bombers hit Kestria'],
    [{ type: 'eliminated', nation: 3, by: 2 }, 'Varlonia wiped out Kestria'],
    [{ type: 'eliminated', nation: 1, by: 2 }, 'Varlonia wiped you out'],
    [{ type: 'eliminated', nation: 3, by: 0 }, 'Kestria found nowhere to start and is out'],
    [{ type: 'eliminated', nation: 1, by: 0 }, 'You found nowhere to start and are out'],
    [{ type: 'rejected', nation: 1, reason: 'not enough gold' }, 'Can’t do that: not enough gold'],
    [{ type: 'buildingCaptured', from: 1, to: 2, building: 'factory', tile: 0 }, 'Varlonia captured your factory'],
    [{ type: 'phase', phase: 'playing' }, 'The war begins!'],
    [{ type: 'relation', a: 1, b: 2, relation: 'war' }, 'You are at war with Varlonia'],
    [{ type: 'radarWarning', nation: 1, from: 2, unit: 'bomber', tile: 0 }, 'Bombers incoming from Varlonia!'],
  ])('%j', (e, text) => expect(say(e)).toBe(text));

  it('skips events not worth a line', () => {
    expect(say({ type: 'attackStarted', attacker: 1, target: 0, troops: 10 })).toBeNull();
    expect(say({ type: 'spawned', nation: 1, tile: 0 })).toBeNull();
  });

  it('aid lines', () => {
    const team = new Map([[1, 'You'], [4, 'Nuni'], [5, 'Danmek']]);
    const line = (e: GameEvent): string | null => describeEvent(e, team, 1);
    const sent = (from: number, to: number, gold: number, troops: number): GameEvent => ({ type: 'aidSent', from, to, gold, troops });
    expect(line(sent(4, 1, 0, 4200))).toBe('Nuni sent you 4.2k troops');
    expect(line(sent(4, 1, 1200, 0))).toBe('Nuni sent you 1.2k gold');
    expect(line(sent(4, 1, 1200, 4200))).toBe('Nuni sent you 4.2k troops and 1.2k gold');
    expect(line(sent(1, 4, 1000, 0))).toBe('You sent Nuni 1k gold');
    expect(line(sent(4, 5, 1000, 0))).toBeNull();
    const answer = (accepted: boolean, reason?: 'busy' | 'cantSpare' | 'notNow'): GameEvent => ({
      type: 'requestResolved', requestId: 7, kind: 'aid', from: 1, to: 5, accepted, ...(reason && { reason }),
    });
    expect(line(answer(false, 'busy'))).toBe('Danmek says no: busy with its own war');
    expect(line(answer(false, 'cantSpare'))).toBe('Danmek says no: can’t spare any');
    expect(line(answer(false, 'notNow'))).toBe('Danmek says no: not now');
    expect(line(answer(false))).toBe('Danmek declined your ask for help');
    expect(line(answer(true))).toBeNull();
    const request = { id: 8, kind: 'aid' as const, from: 4, to: 1, expiresAt: 300 };
    expect(line({ type: 'request', request: { ...request, resource: 'troops' } })).toBe('Nuni asks you for troops');
    expect(line({ type: 'request', request: { ...request, resource: 'gold' } })).toBe('Nuni asks you for gold');
  });
});
