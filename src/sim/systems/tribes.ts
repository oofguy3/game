import { CONFIG } from '../../shared/config';
import type { MapChoice, MapSize, TileIndex } from '../../shared/types';
import type { Game } from '../core/game';
import { inBounds, isLand, tileOf, xOf, yOf } from '../map/grid';
import type { Rng } from '../util/rng';
import { nationNames } from '../core/names';
import { startAttack } from './attacks';

/** Salt for the stream that names tribes, clear of the nation-name salt. */
const TRIBE_NAME_SALT = 17;
/** Salt for the stream that places tribes. Forking leaves the game's own stream alone. */
const TRIBE_PLACE_SALT = 18;

/** Invented names for the small neutral tribes players farm at the start. */
export const TRIBE_NAMES: readonly string[] = [
  'Storm Bison', 'Clawwatch', 'Tuskfell', 'Fenhearth', 'Red Kestrel', 'Ashmarch', 'Briarholt', 'Moonfen',
  'Ironhoof', 'Saltwarren', 'Duskbarrow', 'Cindervale', 'Wolfreed', 'Hartglass', 'Mirepeak', 'Goldtusk',
  'Thornwake', 'Pale Harbor', 'Runehill', 'Oakbanner', 'Sable Ford', 'High Lichen', 'Cragowl', 'Vellum',
  'Nettledeep', 'Frostkiln', 'Amber Den', 'Quickwater', 'Hollow Antler', 'Greyspire', 'Pebbleking', 'Yarrow',
  'Black Mead', 'Loamwatch', 'Stern Elms', 'Kite Barrow', 'Low Gorse', 'Copper Fen', 'Wild Acre', 'Hearthless',
];

/** How many tribes a match on `choice` should scatter. Random and box maps stay lighter than the world. */
export function tribeCountFor(choice: MapChoice): number {
  if (choice.kind === 'world') return 36;
  const bySize: Record<MapSize, number> = { small: 6, medium: 12, large: 18 };
  return bySize[choice.size] + (choice.kind === 'box' ? 4 : 0);
}

/** `count` tribe names: the fixed list first (shuffled), then invented ones if more are needed. */
export function tribeNameList(rng: Rng, count: number): string[] {
  const pool = [...TRIBE_NAMES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  if (count <= pool.length) return pool.slice(0, count);
  return [...pool, ...nationNames(rng, count - pool.length)];
}

/** The rng stream tribe names come from, so naming them never disturbs the game. */
export function tribeNameRng(game: Game): Rng {
  return game.rng.fork(TRIBE_NAME_SALT);
}

/**
 * Puts every unspawned tribe on a small disk of free land, clear of the other spawns. A tribe that finds nowhere is
 * eliminated. Safe to call once; a second call does nothing.
 */
export function placeTribes(game: Game): void {
  if (game.tribesPlaced) return;
  game.tribesPlaced = true;
  const rng = game.rng.fork(TRIBE_PLACE_SALT);
  for (const nation of game.nations) {
    if (nation.role !== 'tribe' || !nation.alive || nation.spawned) continue;
    const tile = findTribeSpot(game, rng);
    if (tile === null) {
      nation.alive = false;
      game.emit({ type: 'eliminated', nation: nation.id, by: 0 });
      continue;
    }
    claimDisk(game, nation.id, tile, CONFIG.tribes.radius);
    nation.spawned = true;
    nation.spawnTile = tile;
    nation.troops = CONFIG.tribes.troops;
    nation.gold = CONFIG.tribes.gold;
    nation.shield = false;
    game.emit({ type: 'spawned', nation: nation.id, tile });
  }
}

/**
 * Every `thinkTicks`, each living tribe pushes into adjacent empty land. One that is being attacked pushes back at
 * whoever is attacking it, when they share a border.
 */
export function stepTribes(game: Game): void {
  if (game.phase !== 'playing' || game.tick % CONFIG.tribes.thinkTicks !== 0) return;
  const ratio = CONFIG.tribes.expandRatio;
  for (const nation of game.nations) {
    if (nation.role !== 'tribe' || !nation.alive || nation.tiles === 0) continue;
    const attacker = game.attacks.find((a) => a.target === nation.id)?.attacker;
    if (attacker !== undefined && game.nations[attacker].alive) {
      const border = [...nation.border].find((t) => touchesOwner(game, t, attacker));
      if (border !== undefined) {
        const tile = neighborOwned(game, border, attacker);
        if (tile !== null) startAttack(game, nation.id, attacker, Math.max(1, Math.floor(nation.troops * ratio)), undefined);
      }
      continue;
    }
    const border = [...nation.border].find((t) => touchesOwner(game, t, 0));
    if (border === undefined) continue;
    const tile = neighborOwned(game, border, 0);
    if (tile === null) continue;
    const troops = Math.floor(nation.troops * ratio);
    if (troops >= 1) startAttack(game, nation.id, 0, troops);
  }
}

function findTribeSpot(game: Game, rng: Rng): TileIndex | null {
  const { map } = game;
  const size = map.width * map.height;
  const spacing = CONFIG.tribes.spacing;
  const others = game.nations.filter((n) => n.spawnTile >= 0).map((n) => n.spawnTile);
  for (let i = 0; i < CONFIG.spawn.randomSamples; i++) {
    const tile = rng.int(0, size - 1);
    if (!isLand(map, tile) || game.owner[tile] !== 0) continue;
    const x = xOf(map, tile);
    const y = yOf(map, tile);
    let clear = true;
    for (const other of others) {
      const dx = x - xOf(map, other);
      const dy = y - yOf(map, other);
      if (dx * dx + dy * dy < spacing * spacing) {
        clear = false;
        break;
      }
    }
    if (clear) return tile;
  }
  return null;
}

function claimDisk(game: Game, id: number, centre: TileIndex, radius: number): void {
  const { map } = game;
  const cx = xOf(map, centre);
  const cy = yOf(map, centre);
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (!inBounds(map, x, y) || (x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      const t = tileOf(map, x, y);
      if (isLand(map, t) && game.owner[t] === 0) game.setOwner(t, id);
    }
  }
}

function touchesOwner(game: Game, tile: TileIndex, owner: number): boolean {
  const { map } = game;
  const x = xOf(map, tile);
  const y = yOf(map, tile);
  const near = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
  return near.some(([nx, ny]) => inBounds(map, nx, ny) && game.owner[tileOf(map, nx, ny)] === owner && (owner !== 0 || isLand(map, tileOf(map, nx, ny))));
}

function neighborOwned(game: Game, tile: TileIndex, owner: number): TileIndex | null {
  const { map } = game;
  const x = xOf(map, tile);
  const y = yOf(map, tile);
  for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
    if (!inBounds(map, nx, ny)) continue;
    const t = tileOf(map, nx, ny);
    if (game.owner[t] === owner && (owner !== 0 || isLand(map, t))) return t;
  }
  return null;
}
