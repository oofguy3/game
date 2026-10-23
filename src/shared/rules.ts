import { BUILDING_TYPES } from './types';
import type { BuildingType } from './types';

/** How a match is played: free-for-all or teams, capitals, and the custom rules. */
export interface MatchRules {
  mode: 'ffa' | 'teams';
  /** How many teams there are; used when `mode` is 'teams'. */
  teams: 2 | 3 | 4;
  capitals: boolean;
  richStart: boolean;
  fastBuilding: boolean;
  bigArmies: boolean;
  noPlanes: boolean;
  noAlliances: boolean;
  /** The share of the land that wins the match. */
  winShare: 0.6 | 0.8 | 1;
}

/** Free-for-all with every switch off, won at 80% of the land: the game as it has always been. */
export const DEFAULT_RULES: MatchRules = {
  mode: 'ffa', teams: 2, capitals: false, richStart: false, fastBuilding: false, bigArmies: false, noPlanes: false,
  noAlliances: false, winShare: 0.8,
};

/** The on/off fields of the rules. */
type Switch = 'capitals' | 'richStart' | 'fastBuilding' | 'bigArmies' | 'noPlanes' | 'noAlliances';

/** Each switch with its URL parameter and its name in the rules label, in label order. */
const SWITCHES: readonly { key: Switch; param: string; name: string }[] = [
  { key: 'capitals', param: 'capitals', name: 'Capitals' },
  { key: 'richStart', param: 'rich', name: 'Rich start' },
  { key: 'fastBuilding', param: 'fast', name: 'Fast building' },
  { key: 'bigArmies', param: 'big', name: 'Big armies' },
  { key: 'noPlanes', param: 'noplanes', name: 'No planes' },
  { key: 'noAlliances', param: 'noalliances', name: 'No alliances' },
];

const MODES: readonly MatchRules['mode'][] = ['ffa', 'teams'];
const TEAM_COUNTS: readonly MatchRules['teams'][] = [2, 3, 4];
const WIN_SHARES: readonly MatchRules['winShare'][] = [0.6, 0.8, 1];

/** The buildings that need planes: airports, anti-air guns and radar stations. */
export const PLANE_BUILDINGS: readonly BuildingType[] = ['airport', 'antiAir', 'radar'];

/**
 * The rules from URL parameters (`mode=teams&teams=3&capitals=1&rich=1&fast=1&big=1&noplanes=1&noalliances=1&win=60`).
 * A switch is on only for the value `1`; a missing or bad value keeps the default.
 */
export function rulesFromParams(p: URLSearchParams): MatchRules {
  const raw: Record<string, unknown> = {
    mode: p.get('mode'),
    teams: Number(p.get('teams')),
    winShare: Number(p.get('win')) / 100,
  };
  for (const { key, param } of SWITCHES) raw[key] = p.get(param) === '1';
  return sanitizeRules(raw);
}

/**
 * Rules from untrusted data, such as stored menu choices: each field is checked on its own, and a missing or bad one
 * gets the default.
 */
export function sanitizeRules(raw: unknown): MatchRules {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const oneOf = <T>(allowed: readonly T[], value: unknown, fallback: T): T =>
    allowed.includes(value as T) ? value as T : fallback;
  const rules: MatchRules = {
    ...DEFAULT_RULES,
    mode: oneOf(MODES, r.mode, DEFAULT_RULES.mode),
    teams: oneOf(TEAM_COUNTS, r.teams, DEFAULT_RULES.teams),
    winShare: oneOf(WIN_SHARES, r.winShare, DEFAULT_RULES.winShare),
  };
  for (const { key } of SWITCHES) {
    const value = r[key];
    if (typeof value === 'boolean') rules[key] = value;
  }
  return rules;
}

/** The short label for the rules shown in the game, e.g. "3 teams · Capitals · Rich start · Win at 60%". */
export function describeRules(r: MatchRules): string {
  const parts = [r.mode === 'teams' ? `${r.teams} teams` : 'Free-for-all'];
  for (const { key, name } of SWITCHES) if (r[key]) parts.push(name);
  if (r.winShare !== DEFAULT_RULES.winShare) parts.push(`Win at ${Math.round(r.winShare * 100)}%`);
  return parts.join(' · ');
}

/** The fewest bots the rules allow: 1 in free-for-all; with teams, enough for 2 nations a team, the player included. */
export function minBots(r: MatchRules): number {
  return r.mode === 'teams' ? 2 * r.teams - 1 : 1;
}

/** The building types the rules let nations build: every type, less the plane buildings with no planes. */
export function buildableTypes(r: MatchRules): BuildingType[] {
  return r.noPlanes ? BUILDING_TYPES.filter((t) => !PLANE_BUILDINGS.includes(t)) : [...BUILDING_TYPES];
}
