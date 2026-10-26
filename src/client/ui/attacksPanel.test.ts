import { describe, expect, it } from 'vitest';
import { frontLines } from './attacksPanel';

const names = new Map([[1, 'You'], [2, 'France'], [3, 'Storm Bison']]);

describe('frontLines', () => {
  it('names both sides and flags fights that involve the player', () => {
    const lines = frontLines([[2, 1], [1, 3]], [1500, 400], names, 1);
    expect(lines[0]).toEqual({ text: 'France → You  1.5k', incoming: true, outgoing: false });
    expect(lines[1]).toEqual({ text: 'You → Storm Bison  400', incoming: false, outgoing: true });
  });
});
