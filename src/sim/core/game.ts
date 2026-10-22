import { nationColor, UNOWNED_COLOR } from '../../shared/colors';
import { CONFIG } from '../../shared/config';
import type {
  Command, Difficulty, GameEvent, GameResult, NationId, Personality, Phase, TileIndex,
} from '../../shared/types';
import type { GameMap } from '../map/gameMap';
import { forEachNeighbor, xOf, yOf } from '../map/grid';
import { buildWaterNav } from '../map/waterNav';
import type { WaterNav } from '../map/waterNav';
import { Relations } from '../systems/relations';
import { endSpawnPhase } from '../systems/spawn';
import { Rng } from '../util/rng';
import { applyCommand } from './commands';
import { nationNames } from './names';
import { createNation } from './nation';
import type { Nation } from './nation';

export interface GameSetup {
  map: GameMap;
  seed: number;
  player: { name: string } | null;
  bots: { difficulty: Difficulty; personality?: Personality }[];
  spawnTicks?: number;
  debug?: boolean;
  /** Whether `step` ends the game on a win condition. Defaults to true. */
  checkVictory?: boolean;
}

/**
 * How far apart nations should start: the side of a square holding 1/`spacingSharesPerNation` of one nation's fair
 * share of the land, kept between `minDistanceFloor` and `minDistance`. With no nations there is no crowding.
 */
function spawnSpacingFor(landCount: number, nationCount: number): number {
  const { minDistance, minDistanceFloor, spacingSharesPerNation } = CONFIG.spawn;
  if (nationCount === 0) return minDistance;
  return Math.max(minDistanceFloor, Math.min(minDistance, Math.sqrt(landCount / (nationCount * spacingSharesPerNation))));
}

const UNOWNED_NAME = 'Unowned';
/** Salt for the Rng stream that names the bots, so naming never disturbs the game's own stream. */
const NAMES_RNG_SALT = 1;

export class Game {
  readonly map: GameMap;
  readonly nav: WaterNav;
  readonly rng: Rng;
  readonly debug: boolean;
  readonly checkVictory: boolean;
  tick = 0;
  phase: Phase = 'spawn';
  result: GameResult | null = null;
  spawnEndsAt: number;
  /** Minimum distance between the spawns that nations choose; random spawns relax it when the map is crowded. */
  spawnSpacing: number;
  /** Owning nation per tile; 0 = unowned. */
  owner: Uint16Array;
  /** Indexed by nation id; `nations[0]` is the placeholder for unowned land and is never alive. */
  nations: Nation[];
  /** The human player's nation id, or 0 when there is no player. */
  playerId: NationId;
  relations: Relations;
  /** Called after each ownership change, once the game state is already updated. */
  onOwnerChange: ((tile: TileIndex, from: NationId, to: NationId) => void)[] = [];

  private pending: Command[] = [];
  private events: GameEvent[] = [];
  private changedTiles: TileIndex[] = [];
  private lastId = 0;

  constructor(setup: GameSetup) {
    this.map = setup.map;
    this.nav = buildWaterNav(setup.map);
    this.rng = new Rng(setup.seed);
    this.debug = setup.debug ?? false;
    this.checkVictory = setup.checkVictory ?? true;
    this.spawnEndsAt = setup.spawnTicks ?? CONFIG.spawn.phaseTicks;
    this.owner = new Uint16Array(setup.map.width * setup.map.height);

    const unowned = createNation({
      id: 0, name: UNOWNED_NAME, color: UNOWNED_COLOR, isPlayer: false, difficulty: null, personality: null,
    });
    unowned.alive = false;
    this.nations = [unowned];
    if (setup.player) {
      this.nations.push(createNation({
        id: 1, name: setup.player.name, color: nationColor(1, true), isPlayer: true, difficulty: null, personality: null,
      }));
    }
    this.playerId = setup.player ? 1 : 0;
    const names = nationNames(this.rng.fork(NAMES_RNG_SALT), setup.bots.length);
    setup.bots.forEach((bot, i) => {
      const id = this.nations.length;
      this.nations.push(createNation({
        id, name: names[i], color: nationColor(id, false), isPlayer: false,
        difficulty: bot.difficulty, personality: bot.personality ?? null,
      }));
    });
    this.relations = new Relations(this.nations.length);
    this.spawnSpacing = spawnSpacingFor(setup.map.landCount, this.nations.length - 1);
  }

  /** A fresh id for buildings, units, requests and the like; ids start at 1. */
  nextId(): number {
    return ++this.lastId;
  }

  queue(cmd: Command): void {
    this.pending.push(cmd);
  }

  /**
   * Applies the queued commands in order, then advances the clock by one tick. In the spawn phase that is all it does,
   * except that the phase ends (random starts for everyone left) once the clock reaches `spawnEndsAt`.
   */
  step(): void {
    const commands = this.pending;
    this.pending = [];
    for (const cmd of commands) applyCommand(this, cmd);
    if (this.phase === 'spawn') {
      this.tick++;
      if (this.tick >= this.spawnEndsAt) endSpawnPhase(this);
      return;
    }
    this.tick++;
  }

  /**
   * Gives `tile` to nation `to` (0 = unowned), keeping tile counts, border sets, centroid sums, peak tiles and the
   * changed-tile list in step. Calls the `onOwnerChange` hooks afterwards. Does nothing if the owner is unchanged.
   */
  setOwner(tile: TileIndex, to: NationId): void {
    const from = this.owner[tile];
    if (from === to) return;
    this.owner[tile] = to;
    const x = xOf(this.map, tile);
    const y = yOf(this.map, tile);
    if (from !== 0) {
      const loser = this.nations[from];
      loser.tiles--;
      loser.sumX -= x;
      loser.sumY -= y;
      loser.border.delete(tile);
    }
    if (to !== 0) {
      const gainer = this.nations[to];
      gainer.tiles++;
      gainer.sumX += x;
      gainer.sumY += y;
      if (gainer.tiles > gainer.stats.peakTiles) gainer.stats.peakTiles = gainer.tiles;
      this.refreshBorder(tile);
    }
    forEachNeighbor(this.map, tile, this.refreshBorder);
    this.changedTiles.push(tile);
    for (const hook of this.onOwnerChange) hook(tile, from, to);
  }

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  drainEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  drainChangedTiles(): TileIndex[] {
    const tiles = this.changedTiles;
    this.changedTiles = [];
    return tiles;
  }

  alive(): Nation[] {
    return this.nations.filter((n) => n.alive);
  }

  /** Brings the border-set membership of an owned tile in line with its neighbours. */
  private readonly refreshBorder = (t: TileIndex): void => {
    const owner = this.owner[t];
    if (owner === 0) return;
    const border = this.nations[owner].border;
    if (this.touchesOutsider(t, owner)) border.add(t);
    else border.delete(t);
  };

  /** True when some 4-neighbour of `t` is not owned by `owner`. The map edge doesn't count. */
  private touchesOutsider(t: TileIndex, owner: NationId): boolean {
    const { width, height } = this.map;
    const x = t % width;
    const owners = this.owner;
    return (t >= width && owners[t - width] !== owner)
      || (x > 0 && owners[t - 1] !== owner)
      || (x < width - 1 && owners[t + 1] !== owner)
      || (t < width * (height - 1) && owners[t + width] !== owner);
  }
}
