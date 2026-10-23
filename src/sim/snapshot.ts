import { CONFIG } from '../shared/config';
import type { MapChoice, NationId, Relation, TileIndex } from '../shared/types';
import type { BuildingSnap, GameUpdate, InitPayload, LookOptions, NationSnap } from '../worker/protocol';
import type { Game } from './core/game';
import { inBounds, tileOf } from './map/grid';
import { WORLD_PROJECTION } from './map/worldMap';
import type { Match } from './match';
import { goldIncome, maxTroops } from './systems/economy';

/** How far from a nation's centroid (in tiles) its label may move to sit on its own land. */
const LABEL_SEARCH = 30;
const LABEL_SCALE = 0.6;
/** Random maps pretend to span these latitudes north and south, so snow gathers near the top and bottom edges. */
const RANDOM_MAP_LATITUDE = 72;

type Label = NationSnap['label'];

/** What buildUpdate remembers between calls for a match. */
interface SnapshotState {
  buildingsVersion: number;
  labels: Label[];
  labelsAt: number;
}
const states = new WeakMap<Match, SnapshotState>();

/**
 * How the page dresses a map: the world map spans its projection's latitudes with dry subtropical bands and a fixed
 * seed; a random map spans ±RANDOM_MAP_LATITUDE and uses its own seed.
 */
export function lookOptions(choice: MapChoice): LookOptions {
  if (choice.kind === 'world') {
    return { latitude: { top: WORLD_PROJECTION.latMax, bottom: WORLD_PROJECTION.latMin }, seed: 1, dryBands: true };
  }
  return { latitude: { top: RANDOM_MAP_LATITUDE, bottom: -RANDOM_MAP_LATITUDE }, seed: choice.seed, dryBands: false };
}

/** The match's fixed facts: the map (a copy of its terrain, safe to transfer), who's playing, and how to dress it. */
export function buildInit(match: Match, look: LookOptions): InitPayload {
  const { game } = match;
  return {
    width: game.map.width,
    height: game.map.height,
    terrain: new Uint8Array(game.map.terrain),
    playerId: game.playerId,
    nations: game.nations.slice(1).map((n) => ({ id: n.id, name: n.name, color: n.color, isPlayer: n.isPlayer })),
    spawnEndsAt: game.spawnEndsAt,
    look,
  };
}

/**
 * What changed since the last call: drains the changed tiles (each reported once, with its current owner) and the
 * events; snapshots every nation (labels recomputed every `labelEveryTicks`), the buildings when any changed, and the
 * requests waiting on the player.
 */
export function buildUpdate(match: Match): GameUpdate {
  const { game } = match;
  let state = states.get(match);
  if (!state) {
    state = { buildingsVersion: -1, labels: [], labelsAt: -Infinity };
    states.set(match, state);
  }

  const tiles = uniqueTiles(game.drainChangedTiles());
  const changedTiles = new Uint32Array(tiles);
  const changedOwners = new Uint16Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) changedOwners[i] = game.owner[tiles[i]];

  if (game.tick - state.labelsAt >= CONFIG.client.labelEveryTicks || state.labels.length !== game.nations.length) {
    state.labels = game.nations.map((n) => (n.id === 0 ? null : labelFor(game, n.id)));
    state.labelsAt = game.tick;
  }

  let buildings: BuildingSnap[] | null = null;
  if (game.buildings.version !== state.buildingsVersion) {
    state.buildingsVersion = game.buildings.version;
    buildings = [...game.buildings.byId.values()].map((b) => ({
      id: b.id, type: b.type, owner: b.owner, tile: b.tile, underConstruction: b.ticksLeft > 0,
    }));
  }

  const player = game.playerId;
  return {
    tick: game.tick,
    phase: game.phase,
    changedTiles,
    changedOwners,
    nations: game.nations.slice(1).map((n) => ({
      id: n.id,
      troops: n.troops,
      maxTroops: maxTroops(game, n),
      gold: n.gold,
      income: goldIncome(game, n),
      tiles: n.tiles,
      alive: n.alive,
      spawned: n.spawned,
      relationToPlayer: relationToPlayer(game, n.id),
      embargoed: player !== 0 && n.id !== player && game.relations.embargoed(player, n.id),
      allies: n.alive ? alliesOf(game, n.id) : [],
      attackingPlayer: attackingPlayer(game, n.id),
      label: state.labels[n.id] ?? null,
      stats: { ...n.stats },
    })),
    buildings,
    units: [...game.units.values()].map((u) => ({ id: u.id, type: u.type, owner: u.owner, x: u.x, y: u.y, troops: u.troops })),
    events: game.drainEvents(),
    requests: player === 0 ? [] : [...game.requests.values()].filter((r) => r.to === player),
    result: game.result,
    fronts: frontsOf(game),
  };
}

/** The running attacks between two nations as [attacker, target], each pair once, sorted. */
function frontsOf(game: Game): [NationId, NationId][] {
  const seen = new Set<number>();
  const out: [NationId, NationId][] = [];
  for (const a of game.attacks) {
    if (a.target === 0) continue;
    const key = a.attacker * game.nations.length + a.target;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([a.attacker, a.target]);
  }
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

function uniqueTiles(tiles: TileIndex[]): TileIndex[] {
  const seen = new Set<TileIndex>();
  const out: TileIndex[] = [];
  for (const t of tiles) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function alliesOf(game: Game, id: NationId): NationId[] {
  const out: NationId[] = [];
  for (const m of game.nations) {
    if (m.id !== 0 && m.id !== id && m.alive && game.relations.get(id, m.id) === 'allied') out.push(m.id);
  }
  return out;
}

function relationToPlayer(game: Game, id: NationId): Relation {
  const player = game.playerId;
  return player === 0 || id === player ? 'neutral' : game.relations.get(player, id);
}

function attackingPlayer(game: Game, id: NationId): number {
  if (game.playerId === 0) return 0;
  let troops = 0;
  for (const a of game.attacks) if (a.attacker === id && a.target === game.playerId) troops += a.troops;
  return troops;
}

/**
 * Where nation `id`'s name goes: its centroid when it owns that tile, else its nearest owned tile within
 * `LABEL_SEARCH` (searched ring by ring). Size grows with the square root of its land. Null without land nearby.
 */
function labelFor(game: Game, id: NationId): Label {
  const n = game.nations[id];
  if (!n.alive || n.tiles === 0) return null;
  const cx = Math.round(n.sumX / n.tiles);
  const cy = Math.round(n.sumY / n.tiles);
  const size = LABEL_SCALE * Math.sqrt(n.tiles);
  const { map } = game;
  for (let r = 0; r <= LABEL_SEARCH; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!inBounds(map, x, y) || game.owner[tileOf(map, x, y)] !== id) continue;
        const d = dx * dx + dy * dy;
        if (best === null || d < best.d) best = { x, y, d };
      }
    }
    if (best) return { x: best.x, y: best.y, size };
  }
  return null;
}
