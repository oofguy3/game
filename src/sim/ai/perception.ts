import { CONFIG } from '../../shared/config';
import type { NationId, Relation, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { forEachNeighbor, isLand } from '../map/grid';
import { defenseMultiplier, density } from '../systems/combat';
import { goldIncome, maxTroops, troopGrowth } from '../systems/economy';

/** What a bot sees of one nation that owns land touching its border. */
export interface NeighborInfo {
  id: NationId;
  /** Distinct tiles of the neighbour that touch my border. */
  sharedBorder: number;
  troops: number;
  tiles: number;
  density: number;
  /** My relation with the neighbour. */
  relation: Relation;
  /** Average defense multiplier over the first `CONFIG.ai.defenseSamples` of the neighbour's tiles touching me. */
  defense: number;
  /** Nations other than me the neighbour is at war with. */
  otherWars: number;
  /** Troops in the neighbour's running attacks on me. */
  attackingMe: number;
  /** Buildings the neighbour owns, finished or not. */
  buildings: number;
}

/** Everything a bot decides from: its own state, its neighbours, the threats to it and the race to win. */
export interface Perception {
  me: NationId;
  troops: number;
  maxTroops: number;
  /** troops ÷ maxTroops. */
  troopRatio: number;
  gold: number;
  /** Gold earned per tick. */
  income: number;
  /** Troops gained per tick (negative above max). */
  growth: number;
  /** Moving average of trade gold per tick. */
  tradeIncome: number;
  tiles: number;
  density: number;
  /** Distinct unowned land tiles touching my border. */
  neutralBorder: number;
  /** In id order. */
  neighbors: NeighborInfo[];
  /** Troops in every running attack on me. */
  incoming: number;
  /** Nations at war with me, in id order. */
  wars: NationId[];
  /** The most troops any neighbour at war with me has; 0 when none. */
  threat: number;
  /** The living nation with the most tiles (lowest id on a tie); 0 when none is alive. */
  leader: NationId;
  /** The leader's share of the map's land. */
  leaderShare: number;
  /** My share of the map's land. */
  myShare: number;
  /** My border tiles that are coastal. */
  coastalTiles: number;
}

interface BorderTally {
  sharedBorder: number;
  defenseSum: number;
  defenseSamples: number;
}

/**
 * What nation `me` sees of the game. One pass over the 4-neighbours of `me`'s border tiles finds the neighbouring
 * nations and the neutral land, counting every touching tile once; one pass over the attacks finds the incoming troops.
 * Reads only public game state and changes nothing.
 */
export function perceive(game: Game, me: NationId): Perception {
  const { map, owner, relations } = game;
  const nation = game.nations[me];
  const { defenseSamples } = CONFIG.ai;

  const seen = new Set<TileIndex>();
  const tallies = new Map<NationId, BorderTally>();
  let neutralBorder = 0;
  const visit = (t: TileIndex): void => {
    const o = owner[t];
    if (o === me || seen.has(t)) return;
    seen.add(t);
    if (o === 0) {
      if (isLand(map, t)) neutralBorder++;
      return;
    }
    if (!game.nations[o].alive) return;
    let tally = tallies.get(o);
    if (!tally) {
      tally = { sharedBorder: 0, defenseSum: 0, defenseSamples: 0 };
      tallies.set(o, tally);
    }
    tally.sharedBorder++;
    if (tally.defenseSamples < defenseSamples) {
      tally.defenseSum += defenseMultiplier(game, t);
      tally.defenseSamples++;
    }
  };
  let coastalTiles = 0;
  for (const b of nation.border) {
    if (map.coastal[b]) coastalTiles++;
    forEachNeighbor(map, b, visit);
  }

  let incoming = 0;
  const attackingMe = new Map<NationId, number>();
  for (const a of game.attacks) {
    if (a.target !== me) continue;
    incoming += a.troops;
    attackingMe.set(a.attacker, (attackingMe.get(a.attacker) ?? 0) + a.troops);
  }

  const neighbors: NeighborInfo[] = [];
  let threat = 0;
  for (const [id, tally] of [...tallies].sort(([a], [b]) => a - b)) {
    const n = game.nations[id];
    const relation = relations.get(me, id);
    if (relation === 'war') threat = Math.max(threat, n.troops);
    neighbors.push({
      id,
      sharedBorder: tally.sharedBorder,
      troops: n.troops,
      tiles: n.tiles,
      density: density(n),
      relation,
      defense: tally.defenseSamples > 0 ? tally.defenseSum / tally.defenseSamples : 1,
      otherWars: relations.warsOf(id).filter((w) => w !== me).length,
      attackingMe: attackingMe.get(id) ?? 0,
      buildings: game.buildings.ofNation(id).length,
    });
  }

  let leader: NationId = 0;
  for (const n of game.nations) {
    if (n.id !== 0 && n.alive && (leader === 0 || n.tiles > game.nations[leader].tiles)) leader = n.id;
  }
  const land = Math.max(1, map.landCount);
  const max = maxTroops(game, nation);

  return {
    me,
    troops: nation.troops,
    maxTroops: max,
    troopRatio: nation.troops / max,
    gold: nation.gold,
    income: goldIncome(game, nation),
    growth: troopGrowth(game, nation),
    tradeIncome: nation.tradeIncome,
    tiles: nation.tiles,
    density: density(nation),
    neutralBorder,
    neighbors,
    incoming,
    wars: relations.warsOf(me),
    threat,
    leader,
    leaderShare: game.nations[leader].tiles / land,
    myShare: nation.tiles / land,
    coastalTiles,
  };
}
