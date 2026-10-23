import { nationColor, teamColor, UNOWNED_COLOR } from '../../shared/colors';
import { CONFIG } from '../../shared/config';
import { DEFAULT_RULES } from '../../shared/rules';
import type { MatchRules } from '../../shared/rules';
import type {
  Command, DiplomacyRequest, Difficulty, GameEvent, GameResult, NationId, Personality, Phase, TileIndex,
} from '../../shared/types';
import type { GameMap } from '../map/gameMap';
import { forEachNeighbor, xOf, yOf } from '../map/grid';
import { buildWaterNav } from '../map/waterNav';
import type { WaterNav } from '../map/waterNav';
import { stepAttacks } from '../systems/attacks';
import type { Attack } from '../systems/attacks';
import { BuildingStore, onTileCaptured, stepBuildings } from '../systems/buildings';
import { stepDiplomacy } from '../systems/diplomacy';
import { stepEconomy } from '../systems/economy';
import { Relations } from '../systems/relations';
import { endSpawnPhase } from '../systems/spawn';
import { stepUnits } from '../systems/units';
import type { Unit } from '../systems/units';
import { checkVictory } from '../systems/victory';
import { Rng } from '../util/rng';
import { applyCommand } from './commands';
import { nationNames } from './names';
import { createNation } from './nation';
import type { Nation } from './nation';
import { assignTeams, lockTeams, TEAM_RNG_SALT } from './teams';
import { tuningFor } from './tuning';
import type { Tuning } from './tuning';

export interface GameSetup {
  map: GameMap;
  seed: number;
  player: { name: string } | null;
  /**
   * One per bot. `team` sets the bot's team in teams mode (as the arena does): when any bot has one, every bot needs
   * one from 1 to the rules' team count, nobody is shuffled and the player, if any, is on team 1.
   */
  bots: { difficulty: Difficulty; personality?: Personality; team?: number }[];
  spawnTicks?: number;
  debug?: boolean;
  /** Whether `step` ends the game on a win condition. Defaults to true. */
  checkVictory?: boolean;
  /** How the match is played; `DEFAULT_RULES` when not given. */
  rules?: MatchRules;
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
  /** How the match is played: the game's own copy of the rules it was set up with. */
  readonly rules: MatchRules;
  /** The numbers the rules give, read by the systems in place of the matching `CONFIG` values. */
  readonly tuning: Tuning;
  tick = 0;
  phase: Phase = 'spawn';
  result: GameResult | null = null;
  spawnEndsAt: number;
  /** Minimum distance between the spawns that nations choose; random spawns relax it when the map is crowded. */
  spawnSpacing: number;
  /** Owning nation per tile; 0 = unowned. */
  owner: Uint16Array;
  /** Goes up with every ownership change, so caches of anything derived from `owner` can tell they are stale. */
  ownerVersion = 0;
  /** Unowned land tiles left on each landmass, by landmass id. */
  readonly unownedLand: Int32Array;
  /** Indexed by nation id; `nations[0]` is the placeholder for unowned land and is never alive. */
  nations: Nation[];
  /** The human player's nation id, or 0 when there is no player. */
  playerId: NationId;
  relations: Relations;
  /** Running attacks, in the order they started. */
  attacks: Attack[] = [];
  /** Every building on the map, finished or under construction. */
  readonly buildings = new BuildingStore();
  /** Pending diplomacy requests by id. */
  readonly requests = new Map<number, DiplomacyRequest>();
  /** Boats, ships and planes by id, in the order they were created. */
  readonly units = new Map<number, Unit>();
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
    this.rules = { ...(setup.rules ?? DEFAULT_RULES) };
    this.tuning = tuningFor(this.rules);
    this.spawnEndsAt = setup.spawnTicks ?? CONFIG.spawn.phaseTicks;
    this.owner = new Uint16Array(setup.map.width * setup.map.height);
    this.unownedLand = Int32Array.from(setup.map.landmassSize);

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
    if (this.rules.mode === 'teams') this.formTeams(setup);
    this.spawnSpacing = spawnSpacingFor(setup.map.landCount, this.nations.length - 1);
    this.onOwnerChange.push((tile, from, to) => onTileCaptured(this, tile, from, to));
  }

  /** A fresh id for buildings, units, requests and the like; ids start at 1. */
  nextId(): number {
    return ++this.lastId;
  }

  queue(cmd: Command): void {
    this.pending.push(cmd);
  }

  /**
   * Advances the game by one tick. Once the game has ended it does nothing: queued commands are dropped unapplied and
   * the clock stops. Otherwise the queued commands apply in order first. In the spawn phase the clock then advances,
   * and the phase ends (random starts for everyone left) once it reaches `spawnEndsAt`. While playing, the systems run
   * in a fixed order and, when `checkVictory` is on, a win ends the game with a `gameOver` event before the clock
   * advances.
   */
  step(): void {
    if (this.phase === 'ended') {
      this.pending = [];
      return;
    }
    const commands = this.pending;
    this.pending = [];
    for (const cmd of commands) applyCommand(this, cmd);
    if (this.phase === 'spawn') {
      this.tick++;
      if (this.tick >= this.spawnEndsAt) endSpawnPhase(this);
      return;
    }
    stepBuildings(this);
    stepEconomy(this);
    stepAttacks(this);
    stepUnits(this);
    stepDiplomacy(this);
    if (this.checkVictory) {
      const result = checkVictory(this);
      if (result) {
        this.result = result;
        this.phase = 'ended';
        this.emit({ type: 'gameOver', result });
      }
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
    this.ownerVersion++;
    const landmass = this.map.landmass[tile];
    if (landmass >= 0 && (from === 0 || to === 0)) this.unownedLand[landmass] += from === 0 ? -1 : 1;
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

  /**
   * Puts every nation on a team: the bots' own `team` when any has one (the player on team 1), else dealt by
   * `assignTeams` from a stream of their own, so the game's stream is untouched. Each nation then takes a shade of its
   * team's family, numbered within the team in id order, and teammates become allies.
   */
  private formTeams(setup: GameSetup): void {
    const botIds = this.nations.slice(1).filter((n) => !n.isPlayer).map((n) => n.id);
    let teams = new Map<NationId, number>();
    if (setup.bots.some((b) => b.team !== undefined)) {
      if (this.playerId !== 0) teams.set(this.playerId, 1);
      setup.bots.forEach((bot, i) => {
        const team = bot.team;
        if (team === undefined || !Number.isInteger(team) || team < 1 || team > this.rules.teams) {
          throw new Error(`Bot ${i} has team ${team}; with teams given, each bot needs one of 1–${this.rules.teams}`);
        }
        teams.set(botIds[i], team);
      });
    } else {
      teams = assignTeams(this.playerId, botIds, this.rules.teams, this.rng.fork(TEAM_RNG_SALT));
    }
    const inTeam = new Array<number>(this.rules.teams + 1).fill(0);
    for (const n of this.nations.slice(1)) {
      n.team = teams.get(n.id)!;
      n.color = teamColor(n.team, inTeam[n.team]++, n.isPlayer);
    }
    lockTeams(this);
  }
}
