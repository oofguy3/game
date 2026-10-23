import { describe, expect, it } from 'vitest';
import { buildableTypes, DEFAULT_RULES, describeRules, minBots, rulesFromParams, sanitizeRules } from './rules';
import { BUILDING_TYPES } from './types';

describe('rules', () => {
  it('DEFAULT_RULES: free-for-all, every switch off, win at 80%', () => {
    expect(DEFAULT_RULES).toEqual({ mode: 'ffa', teams: 2, capitals: false, richStart: false, fastBuilding: false,
      bigArmies: false, noPlanes: false, noAlliances: false, winShare: 0.8 });
  });

  it('rulesFromParams reads every switch', () => {
    expect(rulesFromParams(new URLSearchParams('mode=teams&teams=3&capitals=1&rich=1&fast=1&big=1&noplanes=1&noalliances=1&win=60')))
      .toEqual({ mode: 'teams', teams: 3, capitals: true, richStart: true, fastBuilding: true, bigArmies: true,
        noPlanes: true, noAlliances: true, winShare: 0.6 });
  });

  it('rulesFromParams keeps the default for every missing or bad value', () => {
    expect(rulesFromParams(new URLSearchParams('mode=foo&teams=9&win=55&capitals=yes'))).toEqual(DEFAULT_RULES);
  });

  it('sanitizeRules keeps the good fields and replaces the bad ones', () => {
    expect(sanitizeRules({ mode: 'teams', teams: 7, winShare: 1, capitals: 'x' })).toEqual({ ...DEFAULT_RULES, mode: 'teams', winShare: 1 });
    expect(sanitizeRules(null)).toEqual(DEFAULT_RULES);
    expect(sanitizeRules('junk')).toEqual(DEFAULT_RULES);
  });

  it('describeRules', () => {
    expect(describeRules(DEFAULT_RULES)).toBe('Free-for-all');
    expect(describeRules({ ...DEFAULT_RULES, winShare: 1 })).toBe('Free-for-all · Win at 100%');
    expect(describeRules(rulesFromParams(new URLSearchParams('mode=teams&teams=3&capitals=1&rich=1&fast=1&big=1&noplanes=1&noalliances=1&win=60'))))
      .toBe('3 teams · Capitals · Rich start · Fast building · Big armies · No planes · No alliances · Win at 60%');
  });

  it('minBots: 1 in free-for-all, 2 × teams − 1 in teams', () => {
    expect(minBots(DEFAULT_RULES)).toBe(1);
    expect([2, 3, 4].map((t) => minBots({ ...DEFAULT_RULES, mode: 'teams', teams: t as 2 | 3 | 4 }))).toEqual([3, 5, 7]);
  });

  it('buildableTypes leaves out the plane buildings with no planes', () => {
    expect(buildableTypes(DEFAULT_RULES)).toEqual(BUILDING_TYPES);
    expect(buildableTypes({ ...DEFAULT_RULES, noPlanes: true })).toEqual(BUILDING_TYPES.filter((t) => !['airport', 'antiAir', 'radar'].includes(t)));
  });
});
