import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../shared/config';
import { DEFAULT_RULES } from '../../shared/rules';
import type { MatchRules } from '../../shared/rules';
import { scaledTicks, tuningFor } from './tuning';

describe('tuningFor', () => {
  it("the default rules give today's numbers", () => {
    expect(tuningFor(DEFAULT_RULES)).toEqual({ startGold: CONFIG.spawn.startGold, goldScale: 1, troopGrowthScale: 1, troopCapScale: 1,
      buildTimeScale: 1, winShare: CONFIG.win.landShare, planes: true, alliances: true, capitals: false, teams: false });
  });

  it('each switch changes its numbers', () => {
    const t = (r: Partial<MatchRules>) => tuningFor({ ...DEFAULT_RULES, ...r });
    expect(t({ richStart: true })).toMatchObject({ startGold: 5000, goldScale: 2 });
    expect(t({ fastBuilding: true }).buildTimeScale).toBe(0.2);
    expect(t({ bigArmies: true })).toMatchObject({ troopGrowthScale: 2, troopCapScale: 2 });
    expect(t({ noPlanes: true, noAlliances: true, capitals: true, mode: 'teams', winShare: 0.6 }))
      .toMatchObject({ planes: false, alliances: false, capitals: true, teams: true, winShare: 0.6 });
  });
});

describe('scaledTicks', () => {
  it('scaledTicks rounds and never goes below 1', () => {
    expect([scaledTicks(100, 0.2), scaledTicks(3, 0.2), scaledTicks(50, 1)]).toEqual([20, 1, 50]);
  });
});
