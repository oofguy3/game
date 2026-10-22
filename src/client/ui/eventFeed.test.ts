import { describe, expect, it } from 'vitest';
import { isAlarm } from './eventFeed';

describe('isAlarm', () => {
  it('marks threats to the player', () => {
    expect(isAlarm({ type: 'radarWarning', nation: 1, from: 2, unit: 'bomber', tile: 0 }, 1)).toBe(true);
    expect(isAlarm({ type: 'attackStarted', attacker: 2, target: 1, troops: 5 }, 1)).toBe(true);
    expect(isAlarm({ type: 'attackStarted', attacker: 1, target: 2, troops: 5 }, 1)).toBe(false);
    expect(isAlarm({ type: 'bombed', by: 2, owner: 1, tile: 0 }, 1)).toBe(true);
    expect(isAlarm({ type: 'bombed', by: 1, owner: 2, tile: 0 }, 1)).toBe(false);
    expect(isAlarm({ type: 'betrayal', betrayer: 2, victim: 1 }, 1)).toBe(true);
    expect(isAlarm({ type: 'trade', nation: 1, partner: 2, gold: 5 }, 1)).toBe(false);
  });
});
