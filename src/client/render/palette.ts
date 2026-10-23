import { Terrain } from '../../shared/types';
import { LOOK } from './look/palette';

/** Flat colours for land nobody owns and for water, from the natural palette (the flat look and the minimap). */
export const TERRAIN_COLORS: Record<Terrain, number> = {
  [Terrain.Water]: LOOK.water,
  [Terrain.Plains]: LOOK.plains,
  [Terrain.Hills]: LOOK.hills,
  [Terrain.Mountains]: LOOK.mountains,
};

/** Shade factor for tiles on a nation's border. */
export const BORDER_SHADE = 0.6;

/** `color` (0xRRGGBB) with every channel multiplied by `f`, clamped to 0..255. */
export function shade(color: number, f: number): number {
  const ch = (shift: number): number => Math.min(255, Math.max(0, Math.round(((color >> shift) & 0xff) * f)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** `color` as an opaque pixel in ImageData's byte order (RGBA bytes, read as a little-endian uint32). */
export function toPixel(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** `color` as a CSS colour string. */
export function css(color: number, alpha = 1): string {
  return `rgba(${(color >> 16) & 0xff}, ${(color >> 8) & 0xff}, ${color & 0xff}, ${alpha})`;
}
