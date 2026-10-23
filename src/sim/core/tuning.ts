import { CONFIG } from '../../shared/config';
import type { MatchRules } from '../../shared/rules';

/** The numbers a match's rules give. The systems read them here where they would otherwise read `CONFIG`. */
export interface Tuning {
  /** The gold a nation starts with. */
  startGold: number;
  /** What all gold income is multiplied by, trade included. */
  goldScale: number;
  /** What troop growth below the troop limit is multiplied by. */
  troopGrowthScale: number;
  /** What the troop limit is multiplied by. */
  troopCapScale: number;
  /** What building times are multiplied by, warships and fighters included. */
  buildTimeScale: number;
  /** The share of the land that wins. */
  winShare: number;
  planes: boolean;
  alliances: boolean;
  capitals: boolean;
  teams: boolean;
}

/** Rich start: the start gold, and what gold income is multiplied by. */
const RICH_START_GOLD = 5000;
const RICH_GOLD_SCALE = 2;
/** Fast building: building times ÷ 5. */
const FAST_BUILD_SCALE = 0.2;
/** Big armies: troop growth and troop limits × 2. */
const BIG_ARMY_SCALE = 2;

/** The numbers for `r`. The default rules give today's `CONFIG` values and scales of 1. */
export function tuningFor(r: MatchRules): Tuning {
  return {
    startGold: r.richStart ? RICH_START_GOLD : CONFIG.spawn.startGold,
    goldScale: r.richStart ? RICH_GOLD_SCALE : 1,
    troopGrowthScale: r.bigArmies ? BIG_ARMY_SCALE : 1,
    troopCapScale: r.bigArmies ? BIG_ARMY_SCALE : 1,
    buildTimeScale: r.fastBuilding ? FAST_BUILD_SCALE : 1,
    winShare: r.winShare,
    planes: !r.noPlanes,
    alliances: !r.noAlliances,
    capitals: r.capitals,
    teams: r.mode === 'teams',
  };
}

/** A build time of `ticks` scaled by `scale`, rounded, and never under 1 tick. */
export function scaledTicks(ticks: number, scale: number): number {
  return Math.max(1, Math.round(ticks * scale));
}
