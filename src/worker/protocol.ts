import type {
  BuildingType, Command, DiplomacyRequest, Difficulty, GameEvent, GameMode, GameResult, MapChoice, NationId, NationRole,
  Phase, Relation, TileIndex, UnitType,
} from '../shared/types';
import type { Nation } from '../sim/core/nation';

/** How the player set up the match on the menu. */
export interface StartOptions {
  map: MapChoice;
  bots: number;
  difficulty: Difficulty;
  seed: number;
  playerName: string;
  debug: boolean;
  /** Free-for-all, or every computer nation starts on one team. Defaults to free-for-all. */
  mode?: GameMode;
}

export type ToWorker =
  | { type: 'start'; options: StartOptions; worldMap?: ArrayBuffer }
  | { type: 'command'; command: Command }
  | { type: 'pause'; paused: boolean };

export type FromWorker =
  | { type: 'init'; init: InitPayload }
  | { type: 'update'; update: GameUpdate }
  | { type: 'error'; message: string };

/** How the page should dress the map: the latitudes of its top and bottom rows, a seed, and dry subtropical bands. */
export interface LookOptions {
  latitude: { top: number; bottom: number };
  seed: number;
  dryBands: boolean;
}

/** Everything that doesn't change during a match, sent once. */
export interface InitPayload {
  width: number;
  height: number;
  terrain: Uint8Array;
  playerId: NationId;
  nations: { id: NationId; name: string; color: number; isPlayer: boolean; role?: NationRole }[];
  spawnEndsAt: number;
  look: LookOptions;
}

export interface NationSnap {
  id: NationId;
  troops: number;
  maxTroops: number;
  gold: number;
  income: number;
  tiles: number;
  alive: boolean;
  spawned: boolean;
  /** This nation's relation with the player ('neutral' for the player itself, or when there is no player). */
  relationToPlayer: Relation;
  /** Whether trade between the player and this nation is switched off, by either side. */
  embargoed: boolean;
  /** Living nations allied with this one, in id order; none once it is eliminated. */
  allies: NationId[];
  /** Troops in this nation's attacks on the player. */
  attackingPlayer: number;
  /** Where to write the nation's name, in tile coordinates, and how big; null without land. */
  label: { x: number; y: number; size: number } | null;
  /** Tiles that count toward the win: land held, minus fallout. */
  scoreTiles?: number;
  role?: NationRole;
  /** Marked TRAITOR after breaking an alliance, until the timer runs out. */
  traitor?: boolean;
  /** Still inside the opening shield. */
  shielded?: boolean;
  stats: Nation['stats'];
}

export interface BuildingSnap {
  id: number;
  type: BuildingType;
  owner: NationId;
  tile: TileIndex;
  underConstruction: boolean;
}

export interface UnitSnap {
  id: number;
  type: UnitType;
  owner: NationId;
  x: number;
  y: number;
  troops: number;
  /** Where a boat or missile is headed, so the map can draw its route. */
  heading?: { x: number; y: number } | null;
}

/** What changed since the last update. */
export interface GameUpdate {
  tick: number;
  phase: Phase;
  /** Tiles whose owner changed, each once, with its owner now at the same index of `changedOwners`. */
  changedTiles: Uint32Array;
  changedOwners: Uint16Array;
  nations: NationSnap[];
  /** Every building, or null when none changed since the last update. */
  buildings: BuildingSnap[] | null;
  units: UnitSnap[];
  events: GameEvent[];
  /** Pending requests addressed to the player. */
  requests: DiplomacyRequest[];
  result: GameResult | null;
  /** Running attacks between two nations as [attacker, target], each pair once, sorted. */
  fronts: [NationId, NationId][];
  /** Troops committed to each front, in the same order. */
  frontTroops?: number[];
  /** Tiles that became fallout since the last update. */
  falloutOn?: Uint32Array;
  /** Tiles scrubbed clean since the last update. */
  falloutOff?: Uint32Array;
}
