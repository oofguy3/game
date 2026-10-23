import { CONFIG } from '../../shared/config';
import type { NationId, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { distance, tileOf, xOf, yOf } from '../map/grid';
import { knockOut } from './attacks';
import type { Building } from './buildings';

/** `nation`'s capital, if it has one. */
export function capitalOf(game: Game, nation: NationId): Building | undefined {
  return game.buildings.ofNation(nation, 'capital')[0];
}

/** Puts `nation`'s capital, finished, on `tile`; one it already had is taken away first (see `liftCapital`). */
export function placeCapital(game: Game, nation: NationId, tile: TileIndex): void {
  liftCapital(game, nation);
  game.buildings.add({ id: game.nextId(), type: 'capital', owner: nation, tile, ticksLeft: 0, cooldown: 0 });
  game.nations[nation].buildingCounts.capital++;
}

/** Takes `nation`'s capital, if any, off the map without a word: a spawn being moved, not a capital destroyed. */
export function liftCapital(game: Game, nation: NationId): void {
  const capital = capitalOf(game, nation);
  if (!capital) return;
  game.buildings.remove(capital.id);
  game.nations[nation].buildingCounts.capital--;
}

/** Whether another nation's capital stands within Chebyshev distance `landingClearance` of `tile`. */
export function nearEnemyCapital(game: Game, nation: NationId, tile: TileIndex): boolean {
  const { map } = game;
  const r = CONFIG.capitals.landingClearance;
  const x = xOf(map, tile);
  const y = yOf(map, tile);
  const x1 = Math.min(map.width - 1, x + r);
  const y1 = Math.min(map.height - 1, y + r);
  for (let ny = Math.max(0, y - r); ny <= y1; ny++) {
    for (let nx = Math.max(0, x - r); nx <= x1; nx++) {
      const b = game.buildings.at(tileOf(map, nx, ny));
      if (b && b.type === 'capital' && b.owner !== nation) return true;
    }
  }
  return false;
}

/**
 * `from`'s capital has fallen to `to`, and `from` is out: the capital is removed, every other building of `from`
 * (active counts and all) and then every tile of it go to `to`, and `from` is knocked out with its troops and gold
 * lost. Emits `capitalFell` and then `eliminated` with `capital`; the buildings change hands without
 * `buildingCaptured`.
 */
export function fallCapital(game: Game, from: NationId, to: NationId): void {
  const loser = game.nations[from];
  const gainer = game.nations[to];
  liftCapital(game, from);
  for (const b of game.buildings.ofNation(from)) {
    game.buildings.transfer(b.id, to);
    if (b.ticksLeft === 0) {
      loser.buildingCounts[b.type]--;
      gainer.buildingCounts[b.type]++;
    }
  }
  const tiles = loser.tiles;
  // the buildings are already `to`'s, so the ownership hook leaves them be
  for (let t = 0; t < game.owner.length; t++) if (game.owner[t] === from) game.setOwner(t, to);
  knockOut(game, from);
  loser.troops = 0;
  loser.gold = 0;
  game.emit({ type: 'capitalFell', nation: from, by: to, tiles });
  game.emit({ type: 'eliminated', nation: from, by: to, capital: true });
}

/**
 * The `onOwnerChange` hook of a capitals game: a nation losing a tile to another nation within its capital's radius
 * is warned with `capitalThreat`, unless it was warned less than `threatCooldownTicks` ago.
 */
export function noteCapitalThreat(game: Game, tile: TileIndex, from: NationId, to: NationId): void {
  if (from === 0 || to === 0) return;
  const capital = capitalOf(game, from);
  if (!capital || distance(game.map, tile, capital.tile) > CONFIG.buildings.capital.radius) return;
  const last = game.lastThreat.get(from);
  if (last !== undefined && game.tick - last < CONFIG.capitals.threatCooldownTicks) return;
  game.lastThreat.set(from, game.tick);
  game.emit({ type: 'capitalThreat', nation: from, tile: capital.tile });
}
