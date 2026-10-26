import { describe, expect, it } from 'vitest';
import type { NationSnap } from '../../worker/protocol';
import { leaderboardRows } from './leaderboard';

const snap = (id: number, tiles: number, alive = true): NationSnap => ({
  id, troops: 0, maxTroops: 1, gold: 0, income: 0, tiles, alive, spawned: true, relationToPlayer: 'neutral',
  embargoed: false, allies: [], attackingPlayer: 0, label: null, stats: { peakTiles: 0, tilesCaptured: 0, buildingsBuilt: 0, goldEarned: 0 },
});

describe('leaderboardRows', () => {
  it('lists the biggest living nations first, ties by id', () => {
    const rows = leaderboardRows([snap(1, 5), snap(2, 9), snap(3, 9), snap(4, 0, false)], 1, 10);
    expect(rows.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('adds the player below the top rows when they fall outside them', () => {
    const nations = Array.from({ length: 14 }, (_, i) => snap(i + 1, 100 - i));
    const rows = leaderboardRows(nations, 14, 10);
    expect(rows).toHaveLength(11);
    expect(rows[10].id).toBe(14);
    expect(rows.slice(0, 10).map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('leaves tribes off the board', () => {
    const tribe = snap(3, 50);
    tribe.role = 'tribe';
    expect(leaderboardRows([snap(1, 5), tribe, snap(2, 9)], 1, 10).map((r) => r.id)).toEqual([2, 1]);
  });

  it('keeps a defeated player on the board', () => {
    const rows = leaderboardRows([snap(1, 0, false), snap(2, 9)], 1, 10);
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
  });
});
