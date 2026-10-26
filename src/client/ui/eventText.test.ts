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
    [{ type: 'nuked', by: 2, owner: 1, tile: 0, kind: 'atom' }, "Varlonia's atom bomb hit you"],
    [{ type: 'nuked', by: 1, owner: 3, tile: 0, kind: 'mirv' }, 'Your MIRV hit Kestria'],
    [{ type: 'nukeIntercepted', by: 1, owner: 2, tile: 0 }, "Your SAM shot down Varlonia's missile"],
    [{ type: 'betrayal', betrayer: 1, victim: 2 }, 'You broke with Varlonia — TRAITOR for 30s'],
  ])('%j', (e, text) => expect(say(e)).toBe(text));

  it('skips events not worth a line', () => {
    expect(say({ type: 'attackStarted', attacker: 1, target: 0, troops: 10 })).toBeNull();
    expect(say({ type: 'spawned', nation: 1, tile: 0 })).toBeNull();
  });
});
