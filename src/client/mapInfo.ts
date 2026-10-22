import type { TileIndex } from '../shared/types';

/** What the page works out once from the terrain: coasts, and which land and water hang together. */
export class MapInfo {
  /** 1 for land touching water (4-neighbours). */
  readonly coastal: Uint8Array;
  /** Label of each land tile's connected landmass; -1 on water. */
  readonly landmass: Int32Array;
  /** Label of each water tile's connected body; -1 on land. */
  readonly waterBody: Int32Array;
  readonly landmassSize: number[] = [];
  readonly waterBodySize: number[] = [];

  constructor(readonly width: number, readonly height: number, readonly terrain: Uint8Array) {
    const n = width * height;
    this.coastal = new Uint8Array(n);
    this.landmass = new Int32Array(n).fill(-1);
    this.waterBody = new Int32Array(n).fill(-1);
    for (let t = 0; t < n; t++) {
      if (terrain[t] !== 0 && this.neighbors(t).some((m) => terrain[m] === 0)) this.coastal[t] = 1;
    }
    this.label(this.landmass, this.landmassSize, (t) => terrain[t] !== 0);
    this.label(this.waterBody, this.waterBodySize, (t) => terrain[t] === 0);
  }

  isLand(t: TileIndex): boolean {
    return this.terrain[t] !== 0;
  }

  /** The in-bounds 4-neighbours of `t`. */
  neighbors(t: TileIndex): TileIndex[] {
    const { width, height } = this;
    const x = t % width;
    const out: TileIndex[] = [];
    if (x > 0) out.push(t - 1);
    if (x < width - 1) out.push(t + 1);
    if (t >= width) out.push(t - width);
    if (t < width * (height - 1)) out.push(t + width);
    return out;
  }

  /** The water bodies touching land tile `t`. */
  watersOf(t: TileIndex): number[] {
    const out: number[] = [];
    for (const m of this.neighbors(t)) if (this.waterBody[m] >= 0 && !out.includes(this.waterBody[m])) out.push(this.waterBody[m]);
    return out;
  }

  private label(labels: Int32Array, sizes: number[], member: (t: TileIndex) => boolean): void {
    const stack: TileIndex[] = [];
    for (let start = 0; start < labels.length; start++) {
      if (labels[start] !== -1 || !member(start)) continue;
      const id = sizes.length;
      let size = 0;
      labels[start] = id;
      stack.push(start);
      while (stack.length > 0) {
        const t = stack.pop()!;
        size++;
        for (const m of this.neighbors(t)) {
          if (labels[m] === -1 && member(m)) {
            labels[m] = id;
            stack.push(m);
          }
        }
      }
      sizes.push(size);
    }
  }
}
