import type { NationId } from '../../shared/types';
import { BORDER_SHADE, shade, TERRAIN_COLORS, toPixel } from './palette';

const UNKNOWN_NATION = 0x808080;

/**
 * The map as one pixel per tile, ready for ImageData: terrain colours on unowned tiles, nation colours on owned ones,
 * darker on a nation's border (a 4-neighbour owned by anyone else, including water; the map edge doesn't count).
 * Tracks the rectangle of tiles repainted since it was last cleared.
 */
export class TerritoryLayer {
  readonly pixels: Uint32Array;
  dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private readonly fill: Map<NationId, number>;
  private readonly edge: Map<NationId, number>;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly terrain: Uint8Array,
    colors: Map<NationId, number>,
  ) {
    this.pixels = new Uint32Array(width * height);
    this.fill = new Map([...colors].map(([id, c]) => [id, toPixel(c)]));
    this.edge = new Map([...colors].map(([id, c]) => [id, toPixel(shade(c, BORDER_SHADE))]));
    for (let t = 0; t < this.pixels.length; t++) this.pixels[t] = toPixel(TERRAIN_COLORS[terrain[t] as 0 | 1 | 2 | 3]);
    this.dirty = { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  }

  /** Repaints each of `tiles` and its 4 neighbours from `owner`. */
  applyTiles(owner: Uint16Array, tiles: ArrayLike<number>): void {
    const w = this.width;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const x = t % w;
      const y = (t - x) / w;
      this.paint(owner, t, x, y);
      if (x > 0) this.paint(owner, t - 1, x - 1, y);
      if (x < w - 1) this.paint(owner, t + 1, x + 1, y);
      if (y > 0) this.paint(owner, t - w, x, y - 1);
      if (y < this.height - 1) this.paint(owner, t + w, x, y + 1);
    }
  }

  private paint(owner: Uint16Array, t: number, x: number, y: number): void {
    const o = owner[t];
    if (o === 0) this.pixels[t] = toPixel(TERRAIN_COLORS[this.terrain[t] as 0 | 1 | 2 | 3]);
    else this.pixels[t] = this.onBorder(owner, t, x, y, o)
      ? this.edge.get(o) ?? toPixel(shade(UNKNOWN_NATION, BORDER_SHADE))
      : this.fill.get(o) ?? toPixel(UNKNOWN_NATION);
    const d = this.dirty;
    if (d === null) this.dirty = { x0: x, y0: y, x1: x, y1: y };
    else {
      if (x < d.x0) d.x0 = x;
      if (x > d.x1) d.x1 = x;
      if (y < d.y0) d.y0 = y;
      if (y > d.y1) d.y1 = y;
    }
  }

  private onBorder(owner: Uint16Array, t: number, x: number, y: number, o: number): boolean {
    const w = this.width;
    return (x > 0 && owner[t - 1] !== o) || (x < w - 1 && owner[t + 1] !== o)
      || (y > 0 && owner[t - w] !== o) || (y < this.height - 1 && owner[t + w] !== o);
  }
}
