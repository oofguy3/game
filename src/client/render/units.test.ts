import { describe, expect, it } from 'vitest';
import type { UnitSnap } from '../../worker/protocol';
import { UnitInterpolator } from './units';

const unit = (id: number, x: number, y: number): UnitSnap => ({ id, type: 'bomber', owner: 1, x, y, troops: 0 });

describe('UnitInterpolator', () => {
  it('glides each unit from its last position to its new one over an update interval', () => {
    const ip = new UnitInterpolator();
    ip.update([unit(1, 0, 0)], 1000);
    ip.update([unit(1, 10, 4), unit(2, 5, 5)], 1100);
    const at = (now: number) => ip.positions(now).map((p) => [p.unit.id, p.x, p.y]);
    expect(at(1100)).toEqual([[1, 0, 0], [2, 5, 5]]);
    expect(at(1150)).toEqual([[1, 5, 2], [2, 5, 5]]);
    expect(at(1300)).toEqual([[1, 10, 4], [2, 5, 5]]);
    // gone units are dropped
    ip.update([unit(2, 6, 5)], 1200);
    expect(ip.positions(1300).map((p) => p.unit.id)).toEqual([2]);
  });
});
