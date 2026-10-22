import type { Command, NationId } from '../shared/types';
import type { Camera } from './camera';
import type { ClientState } from './state';

export type LandKind = 'unowned' | 'player' | 'enemy';

export interface TestApi {
  state: ClientState;
  /** Where the middle of `tile` is on the page, in CSS pixels. */
  tileToScreen(tile: number): { x: number; y: number };
  findLandTile(kind: LandKind): number | null;
  send(cmd: Command): void;
}

declare global {
  interface Window {
    __test: TestApi;
  }
}

/** Exposes hooks for the browser tests on `window.__test` (only with ?test=1). */
export function installTestApi(state: ClientState, camera: Camera, canvas: HTMLCanvasElement, send: (cmd: Command) => void): void {
  window.__test = {
    state,
    tileToScreen(tile) {
      const w = state.init.width;
      const p = camera.tileToScreen((tile % w) + 0.5, Math.floor(tile / w) + 0.5);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    findLandTile: (kind) => findLandTile(state, kind),
    send,
  };
}

/**
 * A land tile of the given kind. 'unowned': before the player has land, the free tile farthest from everyone's land
 * (a safe spawn); after, free land touching the player's. 'player': one of the player's tiles. 'enemy': another
 * nation's tile, preferably touching the player's.
 */
function findLandTile(state: ClientState, kind: LandKind): number | null {
  const { init, owner } = state;
  const { width, height, terrain, playerId } = init;
  const land = (t: number): boolean => terrain[t] !== 0;
  const touches = (t: number, who: (o: NationId) => boolean): boolean => {
    const x = t % width;
    return (x > 0 && who(owner[t - 1])) || (x < width - 1 && who(owner[t + 1]))
      || (t >= width && who(owner[t - width])) || (t < width * (height - 1) && who(owner[t + width]));
  };
  const isPlayer = (o: NationId): boolean => o === playerId;
  const isEnemy = (o: NationId): boolean => o !== 0 && o !== playerId;
  const hasLand = (state.player?.tiles ?? 0) > 0;

  if (kind === 'player') {
    let any: number | null = null;
    for (let t = 0; t < owner.length; t++) {
      if (owner[t] !== playerId) continue;
      if (!touches(t, (o) => o !== playerId)) return t;
      any ??= t;
    }
    return any;
  }
  if (kind === 'enemy') {
    let any: number | null = null;
    for (let t = 0; t < owner.length; t++) {
      if (!isEnemy(owner[t])) continue;
      if (touches(t, isPlayer)) return t;
      any ??= t;
    }
    return any;
  }
  if (hasLand) {
    for (let t = 0; t < owner.length; t++) if (owner[t] === 0 && land(t) && touches(t, isPlayer)) return t;
  }
  const owned: number[] = [];
  for (let t = 0; t < owner.length; t++) if (owner[t] !== 0) owned.push(t);
  let best: number | null = null;
  let bestDist = -1;
  for (let t = 0; t < owner.length; t++) {
    if (owner[t] !== 0 || !land(t)) continue;
    const x = t % width;
    const y = (t - x) / width;
    let near = Infinity;
    for (const o of owned) {
      const ox = o % width;
      const d = (ox - x) ** 2 + ((o - ox) / width - y) ** 2;
      if (d < near) near = d;
    }
    if (near > bestDist) {
      best = t;
      bestDist = near;
    }
  }
  return best;
}
