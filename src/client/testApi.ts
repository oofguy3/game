import { CONFIG } from '../shared/config';
import type { Command, NationId, TileIndex } from '../shared/types';
import type { Camera } from './camera';
import type { MapInfo } from './mapInfo';
import type { Renderer } from './render/renderer';
import type { ClientState } from './state';

export type FindKind = 'unowned' | 'player' | 'enemy' | 'coastal-unowned' | 'player-interior' | 'player-coastal'
  | 'overseas-enemy' | 'bomb-target';

export interface TestApi {
  state: ClientState;
  /** Where the middle of `tile` is on the page, in CSS pixels. */
  tileToScreen(tile: number): { x: number; y: number };
  /** Zooms in (to at least `TEST_ZOOM`) with `tile` in the middle of the screen; returns where it is on the page. */
  centerOn(tile: number): { x: number; y: number };
  findLandTile(kind: FindKind): number | null;
  send(cmd: Command): void;
  /** Gives the player gold and troops (a debug command; the match must run with ?test=1). */
  grant(amounts: { gold?: number; troops?: number }): void;
  /** Whether the map is drawn by the graphics chip or as the flat picture. */
  look(): 'gl' | 'flat';
  /** The map's colour at the middle of `tile`, without buildings, units or labels on top. */
  sampleMap(tile: number): [number, number, number];
  /** The mean draw time of the recent frames, in ms, and how many frames that covers. */
  frameStats(): { mean: number; frames: number };
  /** Puts `tile` in the middle of the screen at exactly `zoom` (within the camera's limits). */
  zoomTo(zoom: number, tile: number): void;
  /** The water tile farthest from land. */
  findWaterTile(): number | null;
  /** The land tile farthest from water. */
  findInlandTile(): number | null;
  /** Throws the map's graphics context away, as a lost graphics chip would. */
  loseContext(): void;
}

declare global {
  interface Window {
    __test: TestApi;
  }
}

/** Screen pixels per tile `centerOn` zooms to at least, so a click lands on the tile meant. */
const TEST_ZOOM = 8;
/** How deep (rings of own land) 'player-interior' looks at most. */
const MAX_DEPTH = 12;
/** Owned tiles sampled when measuring how far a free tile is from everyone. */
const DISTANCE_SAMPLES = 600;

/** Exposes hooks for the browser tests on `window.__test` (only with ?test=1). */
export function installTestApi(
  state: ClientState, info: MapInfo, camera: Camera, canvas: HTMLCanvasElement, send: (cmd: Command) => void,
  renderer: Renderer,
): void {
  const toPage = (tile: number): { x: number; y: number } => {
    const w = state.init.width;
    const p = camera.tileToScreen((tile % w) + 0.5, Math.floor(tile / w) + 0.5);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  };
  window.__test = {
    state,
    tileToScreen: toPage,
    centerOn(tile) {
      const w = state.init.width;
      camera.centerOn((tile % w) + 0.5, Math.floor(tile / w) + 0.5, TEST_ZOOM);
      return toPage(tile);
    },
    findLandTile: (kind) => findLandTile(state, info, kind),
    send,
    grant: ({ gold, troops }) => send({ type: 'debugGrant', nation: state.init.playerId, gold, troops }),
    look: () => renderer.look,
    sampleMap(tile) {
      const w = state.init.width;
      const p = camera.tileToScreen((tile % w) + 0.5, Math.floor(tile / w) + 0.5);
      return renderer.sample(p.x, p.y);
    },
    frameStats() {
      const frames = renderer.frameMs;
      return { mean: frames.reduce((s, t) => s + t, 0) / Math.max(1, frames.length), frames: frames.length };
    },
    zoomTo(zoom, tile) {
      const w = state.init.width;
      camera.lookAt((tile % w) + 0.5, Math.floor(tile / w) + 0.5, zoom);
    },
    findWaterTile: () => farthestTile(info, 'water'),
    findInlandTile: () => farthestTile(info, 'land'),
    loseContext: () => renderer.debugLoseContext(),
  };
}

/** The tile of `kind` farthest (in 4-neighbour steps) from every tile of the other kind; null when there is none. */
export function farthestTile(info: MapInfo, kind: 'water' | 'land'): TileIndex | null {
  const n = info.width * info.height;
  const mine = (t: TileIndex): boolean => info.isLand(t) === (kind === 'land');
  const dist = new Int32Array(n).fill(-1);
  const queue: TileIndex[] = [];
  for (let t = 0; t < n; t++) {
    if (mine(t)) continue;
    dist[t] = 0;
    queue.push(t);
  }
  for (let i = 0; i < queue.length; i++) {
    const t = queue[i];
    for (const m of info.neighbors(t)) {
      if (dist[m] !== -1) continue;
      dist[m] = dist[t] + 1;
      queue.push(m);
    }
  }
  let best: TileIndex | null = null;
  for (let t = 0; t < n; t++) {
    if (mine(t) && (best === null || dist[t] > dist[best] || (dist[best] !== -1 && dist[t] === -1))) best = t;
  }
  return best;
}

/**
 * A land tile of the given kind, or null:
 * - 'unowned': before the player has land, the free tile farthest from everyone's land (a safe spawn); after, free
 *   land touching the player's;
 * - 'coastal-unowned': the same on the coast, except that before spawning it is a safe start near the others (see
 *   `pickFree`);
 * - 'player': one of the player's tiles, inland if it can;
 * - 'player-interior': the player tile deepest inside the player's land (at least one ring in), clear of buildings;
 * - 'player-coastal': a player tile on the coast of its biggest sea, clear of buildings;
 * - 'enemy': of other nations' tiles touching the player's (or, with none, of all theirs), the nearest to the player's
 *   middle;
 * - 'bomb-target': the non-allied enemy tile nearest one of the player's finished airports, within its range;
 * - 'overseas-enemy': another nation's coast across a sea the player touches, on a landmass the player has no land on
 *   if there is one, else on the player's own landmass but away from the player's land (still a trip by boat).
 */
export function findLandTile(state: ClientState, info: MapInfo, kind: FindKind): number | null {
  const { owner } = state;
  const { width, height } = info;
  const me = state.init.playerId;
  const n = owner.length;
  const isPlayer = (o: NationId): boolean => o === me;
  const isEnemy = (o: NationId): boolean => o !== 0 && o !== me;
  const touches = (t: TileIndex, who: (o: NationId) => boolean): boolean => info.neighbors(t).some((m) => who(owner[m]));
  const hasLand = (state.player?.tiles ?? 0) > 0;
  const spacing = CONFIG.buildings.minSpacing;
  const clear = (t: TileIndex): boolean => {
    const x = t % width;
    const y = Math.floor(t / width);
    return !state.buildings.some((b) => Math.max(Math.abs((b.tile % width) - x), Math.abs(Math.floor(b.tile / width) - y)) <= spacing);
  };
  const mine: TileIndex[] = [];
  for (let t = 0; t < n; t++) if (owner[t] === me) mine.push(t);
  const centre = mine.length === 0 ? null : {
    x: mine.reduce((s, t) => s + (t % width), 0) / mine.length,
    y: mine.reduce((s, t) => s + Math.floor(t / width), 0) / mine.length,
  };
  /** 1 + how many square rings around `t` are all the player's land (up to `MAX_DEPTH`). */
  const ownRings = (t: TileIndex): number => {
    const x = t % width;
    const y = Math.floor(t / width);
    for (let r = 1; r <= MAX_DEPTH; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || owner[ny * width + nx] !== me) return r;
        }
      }
    }
    return MAX_DEPTH + 1;
  };
  const nearest = (candidates: TileIndex[]): TileIndex | null => {
    if (candidates.length === 0) return null;
    if (centre === null) return candidates[0];
    let best = candidates[0];
    let bestD = Infinity;
    for (const t of candidates) {
      const d = ((t % width) - centre.x) ** 2 + (Math.floor(t / width) - centre.y) ** 2;
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  };

  switch (kind) {
    case 'player': {
      for (const t of mine) if (!touches(t, (o) => o !== me)) return t;
      return mine[0] ?? null;
    }
    case 'player-interior': {
      // the deepest clear tile: the most rings of the player's own land around it
      let best: TileIndex | null = null;
      let bestDepth = 1;
      for (const t of mine) {
        if (info.coastal[t] || !clear(t)) continue;
        const depth = ownRings(t);
        if (depth > bestDepth) {
          best = t;
          bestDepth = depth;
        }
      }
      return best;
    }
    case 'player-coastal': {
      let best: TileIndex | null = null;
      let bestSea = -1;
      for (const t of mine) {
        if (!info.coastal[t] || !clear(t)) continue;
        const sea = Math.max(...info.watersOf(t).map((w) => info.waterBodySize[w]));
        if (sea > bestSea) {
          best = t;
          bestSea = sea;
        }
      }
      return best;
    }
    case 'enemy': {
      const enemies: TileIndex[] = [];
      const front: TileIndex[] = [];
      for (let t = 0; t < n; t++) {
        if (!isEnemy(owner[t])) continue;
        enemies.push(t);
        if (touches(t, isPlayer)) front.push(t);
      }
      return nearest(front.length > 0 ? front : enemies);
    }
    case 'bomb-target': {
      const airports = state.buildings.filter((b) => b.owner === me && b.type === 'airport' && !b.underConstruction);
      let best: TileIndex | null = null;
      let bestD = CONFIG.buildings.airport.range ** 2;
      for (let t = 0; t < n; t++) {
        if (!isEnemy(owner[t]) || state.nations.get(owner[t])?.relationToPlayer === 'allied') continue;
        for (const a of airports) {
          const d = ((t % width) - (a.tile % width)) ** 2 + (Math.floor(t / width) - Math.floor(a.tile / width)) ** 2;
          if (d <= bestD) {
            best = t;
            bestD = d;
          }
        }
      }
      return best;
    }
    case 'overseas-enemy': {
      const lands = new Set<number>();
      const seas = new Set<number>();
      for (const t of mine) {
        lands.add(info.landmass[t]);
        if (info.coastal[t]) for (const w of info.watersOf(t)) seas.add(w);
      }
      const overseas: TileIndex[] = [];
      const byBoat: TileIndex[] = [];
      for (let t = 0; t < n; t++) {
        if (!isEnemy(owner[t]) || !info.coastal[t] || !info.watersOf(t).some((w) => seas.has(w))) continue;
        if (!lands.has(info.landmass[t])) overseas.push(t);
        else if (!touches(t, isPlayer)) byBoat.push(t);
      }
      return nearest(overseas.length > 0 ? overseas : byBoat);
    }
    case 'unowned':
    case 'coastal-unowned': {
      const coast = kind === 'coastal-unowned';
      const free = (t: TileIndex): boolean => owner[t] === 0 && info.isLand(t) && (!coast || info.coastal[t] === 1);
      if (hasLand) {
        for (let t = 0; t < n; t++) if (free(t) && touches(t, isPlayer)) return t;
        return null;
      }
      return pickFree(state, info, free, coast);
    }
  }
}

/**
 * A free tile (passing `free`) to start on. 'unowned' (`coast` false): the farthest from every owned tile (a sample
 * of them). 'coastal-unowned': on a landmass and by a sea each at least a tenth of the biggest, and of the tiles at
 * least `2 × spawn.minDistance` from everyone the nearest to them (others in reach, but a safe start); the farthest
 * when none is that far.
 */
function pickFree(state: ClientState, info: MapInfo, free: (t: TileIndex) => boolean, coast: boolean): TileIndex | null {
  const { owner } = state;
  const { width } = info;
  const owned: TileIndex[] = [];
  for (let t = 0; t < owner.length; t++) if (owner[t] !== 0) owned.push(t);
  const step = Math.max(1, Math.floor(owned.length / DISTANCE_SAMPLES));
  const bigLand = Math.max(0, ...info.landmassSize) / 10;
  const bigSea = Math.max(0, ...info.waterBodySize) / 10;
  const safe = coast && owned.length > 0 ? (2 * CONFIG.spawn.minDistance) ** 2 : Infinity;
  let far: TileIndex | null = null;
  let farDist = -1;
  let close: TileIndex | null = null;
  let closeDist = Infinity;
  for (let t = 0; t < owner.length; t++) {
    if (!free(t)) continue;
    if (coast && (info.landmassSize[info.landmass[t]] < bigLand
      || !info.watersOf(t).some((w) => info.waterBodySize[w] >= bigSea))) continue;
    const x = t % width;
    const y = (t - x) / width;
    let near = Infinity;
    for (let i = 0; i < owned.length; i += step) {
      const o = owned[i];
      const ox = o % width;
      const d = (ox - x) ** 2 + ((o - ox) / width - y) ** 2;
      if (d < near) near = d;
    }
    if (near > farDist) {
      far = t;
      farDist = near;
    }
    if (near >= safe && near < closeDist) {
      close = t;
      closeDist = near;
    }
  }
  return close ?? far;
}
