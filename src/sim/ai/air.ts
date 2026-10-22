import { CONFIG } from '../../shared/config';
import type { Command, NationId, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { distance } from '../map/grid';
import { airportInRange } from '../systems/air';
import type { Building } from '../systems/buildings';
import { countUnits } from '../systems/units';
import type { Bot } from './bot';
import { borderTouching, centroidTile, enemyAirports } from './economy';
import { attackBudget } from './military';
import type { Perception } from './perception';

type AttackCommand = Extract<Command, { type: 'attack' }>;

/** Strength of each land defense a bomber may soften up, strongest last. */
const DEFENSES = { defensePost: CONFIG.buildings.defensePost.multiplier, fortress: CONFIG.buildings.fortress.multiplier };

/**
 * Bombs before attacking (hard and insane): when `attack` targets a nation whose front defense is above `bombDefense`
 * and one of our airports is ready and in range, a bomber goes for the strongest defense of theirs within `bombReach`
 * tiles of our border with them (the nearest on a tie), and the attack is held back in `memory.pendingAttack` until
 * the bombs should have fallen. Returns the bomb command, or nothing (attack at once).
 */
export function planCombinedArms(game: Game, p: Perception, bot: Bot, attack: AttackCommand): Command[] {
  if (!bot.profile.combinedArms || bot.memory.pendingAttack !== null) return [];
  const target = game.owner[attack.tile];
  const n = p.neighbors.find((x) => x.id === target);
  if (target === 0 || !n || n.defense <= CONFIG.ai.bombDefense) return [];
  if (p.gold < CONFIG.units.bomber.cost) return [];
  const front = borderTouching(game, p.me, (owner) => owner === target);
  let best: { building: Building; strength: number; reach: number } | null = null;
  for (const type of ['defensePost', 'fortress'] as const) {
    for (const b of game.buildings.ofNation(target, type)) {
      let reach = Infinity;
      for (const f of front) reach = Math.min(reach, distance(game.map, f, b.tile));
      if (reach > CONFIG.ai.bombReach) continue;
      const strength = DEFENSES[type];
      if (best === null || strength > best.strength || (strength === best.strength && reach < best.reach)) {
        best = { building: b, strength, reach };
      }
    }
  }
  if (best === null) return [];
  const airport = airportInRange(game, p.me, best.building.tile);
  if (airport === null) return [];
  const eta = Math.ceil(distance(game.map, airport.tile, best.building.tile) / CONFIG.units.bomber.speed);
  bot.memory.pendingAttack = { target, tile: attack.tile, ratio: attack.ratio, at: game.tick + eta };
  return [{ type: 'bomb', nation: p.me, tile: best.building.tile }];
}

/**
 * Paratroopers behind the front (hard and insane): during a war, with at least `minParaTroops` of the attack budget
 * left after `spent`, drops up to `maxTroopsShare` of our troops on the enemy's densest building cluster (buildings
 * within `paraClusterRadius`) more than `paraDepth` tiles behind its front with us and within reach of a ready airport.
 */
export function chooseParadrop(game: Game, p: Perception, bot: Bot, spent = 0): Command | null {
  if (!bot.profile.combinedArms || !bot.profile.air || p.wars.length === 0) return null;
  const { minParaTroops, paraDepth, paraClusterRadius } = CONFIG.ai;
  const budget = attackBudget(p, bot.profile) - spent;
  if (budget < minParaTroops || p.gold < CONFIG.units.paraPlane.cost || p.troops < 1) return null;
  const ratio = Math.min(budget / p.troops, CONFIG.units.paraPlane.maxTroopsShare);
  if (Math.floor(ratio * p.troops) < minParaTroops) return null;

  let best: { tile: TileIndex; count: number } | null = null;
  for (const enemy of p.wars) {
    const front = borderTouching(game, p.me, (owner) => owner === enemy);
    const theirs = game.buildings.ofNation(enemy);
    for (const b of theirs) {
      if (game.owner[b.tile] !== enemy) continue;
      let depth = Infinity;
      for (const f of front) depth = Math.min(depth, distance(game.map, f, b.tile));
      if (depth <= paraDepth || airportInRange(game, p.me, b.tile) === null) continue;
      let count = 0;
      for (const o of theirs) if (distance(game.map, o.tile, b.tile) <= paraClusterRadius) count++;
      if (best === null || count > best.count) best = { tile: b.tile, count };
    }
  }
  return best === null ? null : { type: 'paradrop', nation: p.me, tile: best.tile, ratio };
}

/**
 * Fighters against air raids (normal and up): when airports of nations at war with us reach our land, one fighter is
 * built per think at our finished airport nearest to them, up to one fighter per two such airports.
 */
export function manageAirDefense(game: Game, p: Perception, bot: Bot): Command[] {
  if (!bot.profile.air || p.wars.length === 0) return [];
  const mine = game.buildings.ofNation(p.me, 'airport').filter((a) => a.ticksLeft === 0);
  if (mine.length === 0 || p.gold < CONFIG.units.fighter.cost) return [];
  const raiders = enemyAirports(game, p).filter((a) => p.wars.includes(a.owner) && reachesUs(game, p.me, a));
  const wanted = Math.ceil(raiders.length / 2);
  if (countUnits(game, p.me, 'fighter') >= wanted) return [];
  let base = mine[0];
  let bestD = Infinity;
  for (const a of mine) {
    const d = Math.min(...raiders.map((r) => distance(game.map, r.tile, a.tile)));
    if (d < bestD) {
      base = a;
      bestD = d;
    }
  }
  return [{ type: 'buildUnit', nation: p.me, unit: 'fighter', buildingId: base.id }];
}

/** Whether `airport` reaches `me`'s land: its centroid or one of its sampled border tiles lies within range. */
function reachesUs(game: Game, me: NationId, airport: Building): boolean {
  const range = CONFIG.buildings.airport.range;
  const centre = centroidTile(game, me);
  if (centre !== null && distance(game.map, centre, airport.tile) <= range) return true;
  return borderTouching(game, me, () => true).some((b) => distance(game.map, b, airport.tile) <= range);
}
