import { CONFIG } from '../../shared/config';
import type { BuildingType, Command, NationId, TileIndex } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import { scaledTicks } from '../core/tuning';
import { distance, isLand, tileOf, xOf, yOf } from '../map/grid';

export interface Building {
  id: number;
  type: BuildingType;
  owner: NationId;
  tile: TileIndex;
  /** Ticks of construction left; 0 = active. */
  ticksLeft: number;
  /** Ticks until it can act again: a port's next trade ship, an airport's next mission. */
  cooldown: number;
  /** Airports only: ticks until the next trade plane (missions use `cooldown`). */
  tradeTimer?: number;
}

/** Building types that must stand on a coastal tile. */
const COASTAL_TYPES: readonly BuildingType[] = ['port', 'navalBase'];

const fail = (reason: string): CommandResult => ({ ok: false, reason });

const byId = (a: Building, b: Building): number => a.id - b.id;

/**
 * Every building on the map, finished or not, indexed by id, by tile and by owner and type. Change buildings only
 * through `add`, `remove` and `transfer` so the indexes stay in step.
 */
export class BuildingStore {
  /** Every building, in the order added. */
  readonly byId = new Map<number, Building>();
  /** Goes up whenever a building is added, removed, changes hands or finishes, so readers can tell if anything changed. */
  version = 0;
  private readonly idAt = new Map<TileIndex, number>();
  /** Per owner, per type: that owner's buildings of the type, sorted by id. */
  private readonly owned = new Map<NationId, Map<BuildingType, Building[]>>();

  at(tile: TileIndex): Building | undefined {
    const id = this.idAt.get(tile);
    return id === undefined ? undefined : this.byId.get(id);
  }

  /** A new array of nation `id`'s buildings (only those of `type`, when given), sorted by id. */
  ofNation(id: NationId, type?: BuildingType): Building[] {
    const lists = this.owned.get(id);
    if (!lists) return [];
    if (type !== undefined) return lists.get(type)?.slice() ?? [];
    const all: Building[] = [];
    for (const list of lists.values()) all.push(...list);
    return all.sort(byId);
  }

  /** Adds `b`. Throws if its id is taken or its tile already holds a building. */
  add(b: Building): void {
    if (this.byId.has(b.id)) throw new Error(`Building id ${b.id} is already in use`);
    if (this.idAt.has(b.tile)) throw new Error(`Tile ${b.tile} already holds a building`);
    this.byId.set(b.id, b);
    this.idAt.set(b.tile, b.id);
    this.insert(b);
    this.version++;
  }

  /** Removes building `id`; does nothing if there is none. */
  remove(id: number): void {
    const b = this.byId.get(id);
    if (!b) return;
    this.byId.delete(id);
    this.idAt.delete(b.tile);
    this.detach(b);
    this.version++;
  }

  /** Makes nation `to` the owner of building `id`; does nothing if there is none. */
  transfer(id: number, to: NationId): void {
    const b = this.byId.get(id);
    if (!b || b.owner === to) return;
    this.detach(b);
    b.owner = to;
    this.insert(b);
    this.version++;
  }

  private listOf(owner: NationId, type: BuildingType): Building[] {
    let lists = this.owned.get(owner);
    if (!lists) {
      lists = new Map();
      this.owned.set(owner, lists);
    }
    let list = lists.get(type);
    if (!list) {
      list = [];
      lists.set(type, list);
    }
    return list;
  }

  /** Puts `b` into its owner's list, keeping the list sorted by id. */
  private insert(b: Building): void {
    const list = this.listOf(b.owner, b.type);
    const after = list.findIndex((other) => other.id > b.id);
    if (after === -1) list.push(b);
    else list.splice(after, 0, b);
  }

  private detach(b: Building): void {
    const list = this.listOf(b.owner, b.type);
    const i = list.indexOf(b);
    if (i === -1) throw new Error(`Building ${b.id} is missing from its owner's index; was its owner set directly?`);
    list.splice(i, 1);
  }
}

/**
 * What `nation`'s next building of `type` costs: the base cost × (1 + `costGrowth` × the buildings of that type the
 * nation owns, finished or not).
 */
export function buildingCost(game: Game, nation: NationId, type: BuildingType): number {
  const owned = game.buildings.ofNation(nation, type).length;
  return CONFIG.buildings[type].cost * (1 + CONFIG.buildings.costGrowth * owned);
}

/**
 * Whether `nation` may put a building of `type` on `tile`. The checks run in this order, and the first that fails
 * gives the reason: the tile is on the map, it is land, the nation owns it, it is coastal (ports and naval bases only),
 * no building of any owner stands within `minSpacing` (Chebyshev distance), and the nation can afford it. Changes
 * nothing.
 */
export function canPlace(game: Game, nation: NationId, type: BuildingType, tile: TileIndex): CommandResult {
  const { map } = game;
  if (!Number.isInteger(tile) || tile < 0 || tile >= map.width * map.height) return fail('off the map');
  if (!isLand(map, tile)) return fail('not land');
  if (game.owner[tile] !== nation) return fail('not your land');
  if (COASTAL_TYPES.includes(type) && map.coastal[tile] === 0) return fail('needs coast');
  if (buildingWithin(game, tile, CONFIG.buildings.minSpacing)) return fail('too close to another building');
  if (game.nations[nation].gold < buildingCost(game, nation, type)) return fail('not enough gold');
  return { ok: true };
}

/**
 * The `build` command: pays for the building and starts its construction, `buildTicks` long (scaled by the rules' build
 * time scale). Reports the reason on failure without emitting `rejected`; `applyCommand` does that.
 */
export function build(game: Game, cmd: Extract<Command, { type: 'build' }>): CommandResult {
  const { nation, building: type, tile } = cmd;
  const placement = canPlace(game, nation, type, tile);
  if (!placement.ok) return placement;
  game.nations[nation].gold -= buildingCost(game, nation, type);
  const ticksLeft = scaledTicks(CONFIG.buildings[type].buildTicks, game.tuning.buildTimeScale);
  game.buildings.add({ id: game.nextId(), type, owner: nation, tile, ticksLeft, cooldown: 0 });
  return { ok: true };
}

/**
 * Advances construction by one tick. A building whose countdown reaches 0 becomes active: its owner's
 * `buildingCounts` and `stats.buildingsBuilt` go up and `buildingDone` is emitted.
 */
export function stepBuildings(game: Game): void {
  for (const b of game.buildings.byId.values()) {
    if (b.ticksLeft === 0) continue;
    b.ticksLeft--;
    if (b.ticksLeft > 0) continue;
    game.buildings.version++;
    const owner = game.nations[b.owner];
    owner.buildingCounts[b.type]++;
    owner.stats.buildingsBuilt++;
    game.emit({ type: 'buildingDone', nation: b.owner, building: b.type, tile: b.tile });
  }
}

/**
 * The `onOwnerChange` hook: a building on a tile taken by another nation changes hands, its active count moving with
 * it, and `buildingCaptured` is emitted; one under construction keeps counting down for its new owner. A building on a
 * tile left unowned is destroyed.
 */
export function onTileCaptured(game: Game, tile: TileIndex, from: NationId, to: NationId): void {
  const b = game.buildings.at(tile);
  if (!b) return;
  if (to === 0) {
    destroyBuilding(game, b.id, 0);
    return;
  }
  game.buildings.transfer(b.id, to);
  if (b.ticksLeft === 0) {
    game.nations[from].buildingCounts[b.type]--;
    game.nations[to].buildingCounts[b.type]++;
  }
  game.emit({ type: 'buildingCaptured', from, to, building: b.type, tile });
}

/** Removes building `id`, uncounting it if it was active, and emits `buildingDestroyed` naming `by` (0 = nobody). */
export function destroyBuilding(game: Game, id: number, by: NationId): void {
  const b = game.buildings.byId.get(id);
  if (!b) return;
  game.buildings.remove(id);
  if (b.ticksLeft === 0) game.nations[b.owner].buildingCounts[b.type]--;
  game.emit({ type: 'buildingDestroyed', owner: b.owner, by, building: b.type, tile: b.tile });
}

/**
 * `owner`'s buildings of the given types, finished or not, whose tile lies within `radius` (Euclidean distance,
 * inclusive) of `tile`, sorted by id.
 */
export function buildingsInRadius(
  game: Game, owner: NationId, types: readonly BuildingType[], tile: TileIndex, radius: number,
): Building[] {
  const found: Building[] = [];
  for (const type of types) {
    for (const b of game.buildings.ofNation(owner, type)) {
      if (distance(game.map, b.tile, tile) <= radius) found.push(b);
    }
  }
  return found.sort(byId);
}

/** Whether any building stands within Chebyshev distance `spacing` of `tile`, `tile` itself included. */
function buildingWithin(game: Game, tile: TileIndex, spacing: number): boolean {
  const { map } = game;
  const x = xOf(map, tile);
  const y = yOf(map, tile);
  const x1 = Math.min(map.width - 1, x + spacing);
  const y1 = Math.min(map.height - 1, y + spacing);
  for (let ny = Math.max(0, y - spacing); ny <= y1; ny++) {
    for (let nx = Math.max(0, x - spacing); nx <= x1; nx++) {
      if (game.buildings.at(tileOf(map, nx, ny))) return true;
    }
  }
  return false;
}
