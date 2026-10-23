import type { GameEvent, NationId, TileIndex } from '../../shared/types';

/** The minimap is at most this big, in CSS pixels. */
export const MINIMAP_MAX = { w: 240, h: 160 } as const;

/** The minimap's size in CSS pixels, and how many of them one tile takes. */
export interface MiniSize {
  w: number;
  h: number;
  scale: number;
}

/** A ring on the minimap: red `danger` where the player is losing land or being bombed, orange where they bombed. */
export interface Flash {
  x: number;
  y: number;
  kind: 'danger' | 'bomb';
  start: number;
}

/** The biggest minimap of the map's shape that fits in `max`. */
export function minimapSize(mapW: number, mapH: number, max: { w: number; h: number } = MINIMAP_MAX): MiniSize {
  const scale = Math.min(max.w / mapW, max.h / mapH);
  return { w: Math.round(mapW * scale), h: Math.round(mapH * scale), scale };
}

/** The part of the map the camera shows, in minimap pixels, clipped to the minimap. */
export function viewBox(cam: { x: number; y: number; zoom: number }, viewW: number, viewH: number, size: MiniSize): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, cam.x * size.scale);
  const y0 = Math.max(0, cam.y * size.scale);
  const x1 = Math.min(size.w, (cam.x + viewW / cam.zoom) * size.scale);
  const y1 = Math.min(size.h, (cam.y + viewH / cam.zoom) * size.scale);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** The map point (in tiles) under minimap point (mx, my). */
export function minimapToTile(mx: number, my: number, size: MiniSize): { x: number; y: number } {
  return { x: mx / size.scale, y: my / size.scale };
}

/**
 * Where lost `tiles` lie, grouped into `cell`×`cell`-tile cells: the middle of each cell's lost tiles (in tiles), the
 * cells with the most first, at most `max`.
 */
export function lossCells(tiles: readonly TileIndex[], width: number, cell = 24, max = 12): { x: number; y: number }[] {
  const groups = new Map<number, { n: number; sx: number; sy: number; first: number }>();
  tiles.forEach((t, i) => {
    const x = t % width;
    const y = (t - x) / width;
    const key = Math.floor(y / cell) * Math.ceil(width / cell) + Math.floor(x / cell);
    const g = groups.get(key) ?? { n: 0, sx: 0, sy: 0, first: i };
    g.n++;
    g.sx += x;
    g.sy += y;
    groups.set(key, g);
  });
  return [...groups.values()]
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .slice(0, max)
    .map((g) => ({ x: g.sx / g.n + 0.5, y: g.sy / g.n + 0.5 }));
}

/** The flashes one update brings for player `me`: the land they lost, then bombs that hit them or that they dropped. */
export function flashesFor(events: readonly GameEvent[], lost: readonly TileIndex[], me: NationId, width: number, now: number): Flash[] {
  const out: Flash[] = lossCells(lost, width).map((c) => ({ ...c, kind: 'danger', start: now }));
  for (const e of events) {
    if (e.type !== 'bombed' || (e.owner !== me && e.by !== me)) continue;
    const x = e.tile % width;
    out.push({ x: x + 0.5, y: (e.tile - x) / width + 0.5, kind: e.owner === me ? 'danger' : 'bomb', start: now });
  }
  return out;
}
