import { describe, expect, it } from 'vitest';
import { makeTestGame } from './testing/fixtures';
import { headToHead, runMatch, winnerOf } from './arena';

describe('arena', () => {
  it('runMatch finishes and ranks every bot', () => {
    const r = runMatch({
      seed: 1,
      size: 'small',
      teams: [{ difficulty: 'easy', count: 2 }, { difficulty: 'insane', count: 2 }],
      maxTicks: 1500,
    });
    expect(r.ranking).toHaveLength(4);
    expect(r.ticks).toBeGreaterThan(0);
    expect(r.ticks).toBeLessThanOrEqual(1500);
    // ranked by land, most first
    for (let i = 1; i < r.ranking.length; i++) expect(r.ranking[i - 1].tiles).toBeGreaterThanOrEqual(r.ranking[i].tiles);
    expect(r.ranking.filter((x) => x.difficulty === 'easy')).toHaveLength(2);
    expect(r.winner).toBe(r.ranking[0].difficulty);
    for (const share of Object.values(r.timeAtMaxShare)) {
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });

  it('credits a shared win to the biggest winner, and a timeout to the biggest nation', () => {
    const g = makeTestGame({
      map: ['##########'], owners: ['abbbbbccdd'], nations: [{}, {}, {}, {}], difficulties: ['easy', 'insane', 'hard', 'normal'],
    });
    expect(winnerOf(g)).toBe('insane');
    g.result = { winners: [1, 3], reason: 'alliance' };
    expect(winnerOf(g)).toBe('hard');
    g.result = { winners: [4], reason: 'landShare' };
    expect(winnerOf(g)).toBe('normal');
  });

  it('is deterministic per seed', () => {
    const spec = { seed: 2, size: 'small' as const, teams: [{ difficulty: 'normal' as const, count: 2 }], maxTicks: 400 };
    expect(runMatch(spec)).toEqual(runMatch(spec));
  });

  it('insane beats easy in ≥ 3 of 4 seeds', () => {
    const r = headToHead('insane', 'easy', [1, 2, 3, 4], 'small', 2, 3000);
    expect(r.aWins + r.bWins + r.draws).toBe(4);
    expect(r.rateA).toBeCloseTo(r.aWins / 4, 12);
    expect(r.aWins).toBeGreaterThanOrEqual(3);
  }, 180_000);
});
