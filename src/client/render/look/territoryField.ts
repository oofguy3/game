/** The inner glow reaches this many tiles in from a border. */
export const EDGE_MAX = 4;
/** What water tiles hold in `owner`: never a nation id, so a coast can be told apart from a border. */
export const WATER_OWNER = 255;
/** `captured` for a tile that never changed owner. */
export const NEVER = -1e9;
/** Edges are recomputed, and textures re-uploaded, in BLOCK×BLOCK-tile blocks. */
export const BLOCK = 32;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Changing a tile can move a border tile up to one step away and an edge distance EDGE_MAX further. */
const REACH = EDGE_MAX + 1;
/**
 * Each block's edges are worked out over the block plus this margin: a path of length at most EDGE_MAX never leaves
 * it, so the block's edges equal a whole-map computation.
 */
const MARGIN = EDGE_MAX;
const DIAGONAL = 1.5;

/**
 * The map's changing data for the graphics chip, one entry per tile:
 * - `owner`: the nation id, WATER_OWNER on water;
 * - `edge`: 0 on a border tile, rising to 255 at EDGE_MAX tiles in (and 255 off owned land);
 * - `captured`: when the tile last changed owner, in seconds on the page clock.
 * A border tile is owned land with a 4-neighbour of land (empty land included) owned by someone else.
 */
export class TerritoryField {
  readonly owner: Uint8Array;
  readonly edge: Uint8Array;
  readonly captured: Float32Array;
  private readonly blocksX: number;
  private readonly blocksY: number;
  /** Per block, the part whose edges must be recomputed in the current `apply`, as [x0, x1)×[y0, y1); empty when x0 ≥ x1. */
  private readonly staleX0: Int32Array;
  private readonly staleX1: Int32Array;
  private readonly staleY0: Int32Array;
  private readonly staleY1: Int32Array;
  /** Blocks repainted since the last `takeDirty`. */
  private readonly dirty: Uint8Array;
  private readonly scratch: Float32Array;

  constructor(readonly width: number, readonly height: number, terrain: Uint8Array) {
    const n = width * height;
    this.owner = new Uint8Array(n);
    for (let t = 0; t < n; t++) if (terrain[t] === 0) this.owner[t] = WATER_OWNER;
    this.edge = new Uint8Array(n).fill(255);
    this.captured = new Float32Array(n).fill(NEVER);
    this.blocksX = Math.ceil(width / BLOCK);
    this.blocksY = Math.ceil(height / BLOCK);
    const blocks = this.blocksX * this.blocksY;
    this.staleX0 = new Int32Array(blocks).fill(width);
    this.staleX1 = new Int32Array(blocks);
    this.staleY0 = new Int32Array(blocks).fill(height);
    this.staleY1 = new Int32Array(blocks);
    this.dirty = new Uint8Array(blocks);
    this.scratch = new Float32Array((BLOCK + 2 * MARGIN) ** 2);
  }

  /**
   * Takes the new owners of `tiles` from `owner`, notes `now` as their capture time, and recomputes the edges within
   * REACH of them (block by block, only over the part of each block that can have changed).
   */
  apply(owner: Uint16Array, tiles: ArrayLike<number>, now: number): void {
    const { width, height, blocksX } = this;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (this.owner[t] === WATER_OWNER) continue;
      this.owner[t] = Math.min(WATER_OWNER - 1, owner[t]);
      this.captured[t] = now;
      const x = t % width;
      const y = (t - x) / width;
      const x0 = Math.max(0, x - REACH);
      const x1 = Math.min(width, x + REACH + 1);
      const y0 = Math.max(0, y - REACH);
      const y1 = Math.min(height, y + REACH + 1);
      for (let by = Math.floor(y0 / BLOCK); by <= Math.floor((y1 - 1) / BLOCK); by++) {
        for (let bx = Math.floor(x0 / BLOCK); bx <= Math.floor((x1 - 1) / BLOCK); bx++) {
          const b = by * blocksX + bx;
          this.staleX0[b] = Math.min(this.staleX0[b], Math.max(x0, bx * BLOCK));
          this.staleX1[b] = Math.max(this.staleX1[b], Math.min(x1, (bx + 1) * BLOCK));
          this.staleY0[b] = Math.min(this.staleY0[b], Math.max(y0, by * BLOCK));
          this.staleY1[b] = Math.max(this.staleY1[b], Math.min(y1, (by + 1) * BLOCK));
        }
      }
    }
    for (let b = 0; b < this.dirty.length; b++) {
      const x0 = this.staleX0[b];
      const x1 = this.staleX1[b];
      if (x0 >= x1) continue;
      const y0 = this.staleY0[b];
      const y1 = this.staleY1[b];
      this.staleX0[b] = width;
      this.staleX1[b] = 0;
      this.staleY0[b] = height;
      this.staleY1[b] = 0;
      this.dirty[b] = 1;
      const wx0 = Math.max(0, x0 - MARGIN);
      const wy0 = Math.max(0, y0 - MARGIN);
      const wx1 = Math.min(width, x1 + MARGIN);
      const wy1 = Math.min(height, y1 + MARGIN);
      edgeWindow(this.owner, width, height, wx0, wy0, wx1, wy1, this.scratch);
      const ww = wx1 - wx0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) this.edge[y * width + x] = edgeByte(this.scratch[(y - wy0) * ww + (x - wx0)]);
      }
    }
  }

  /** The blocks repainted since the last call, in block order and clamped to the map; then forgets them. */
  takeDirty(): Rect[] {
    const out: Rect[] = [];
    for (let b = 0; b < this.dirty.length; b++) {
      if (!this.dirty[b]) continue;
      this.dirty[b] = 0;
      const bx = b % this.blocksX;
      const by = (b - bx) / this.blocksX;
      const x = bx * BLOCK;
      const y = by * BLOCK;
      out.push({ x, y, w: Math.min(BLOCK, this.width - x), h: Math.min(BLOCK, this.height - y) });
    }
    return out;
  }
}

/** `edge` worked out from scratch for the whole map (`owner` as in TerritoryField). */
export function fullEdge(width: number, height: number, owner: Uint8Array): Uint8Array {
  const dist = new Float32Array(width * height);
  edgeWindow(owner, width, height, 0, 0, width, height, dist);
  const out = new Uint8Array(width * height);
  for (let t = 0; t < out.length; t++) out[t] = edgeByte(dist[t]);
  return out;
}

function edgeByte(d: number): number {
  return Math.round((255 * Math.min(d, EDGE_MAX)) / EDGE_MAX);
}

/**
 * Chamfer distance (1 straight, DIAGONAL diagonal) from each owned tile of the window [wx0, wx1)×[wy0, wy1) to the
 * nearest border tile of the same nation, moving only through that nation's tiles; Infinity elsewhere. Written into
 * `out` row by row with the window's width.
 */
function edgeWindow(owner: Uint8Array, width: number, height: number, wx0: number, wy0: number, wx1: number, wy1: number, out: Float32Array): void {
  const ww = wx1 - wx0;
  for (let y = wy0; y < wy1; y++) {
    let i = (y - wy0) * ww;
    for (let x = wx0, t = y * width + wx0; x < wx1; x++, t++, i++) {
      const o = owner[t];
      if (o === 0 || o === WATER_OWNER) {
        out[i] = Infinity;
        continue;
      }
      let m = x > 0 ? owner[t - 1] : o;
      let border = m !== o && m !== WATER_OWNER;
      if (!border && x < width - 1) {
        m = owner[t + 1];
        border = m !== o && m !== WATER_OWNER;
      }
      if (!border && y > 0) {
        m = owner[t - width];
        border = m !== o && m !== WATER_OWNER;
      }
      if (!border && y < height - 1) {
        m = owner[t + width];
        border = m !== o && m !== WATER_OWNER;
      }
      out[i] = border ? 0 : Infinity;
    }
  }
  // forward pass: left, up-left, up, up-right
  for (let y = wy0; y < wy1; y++) {
    const up = y > wy0;
    let i = (y - wy0) * ww;
    for (let x = wx0, t = y * width + wx0; x < wx1; x++, t++, i++) {
      const o = owner[t];
      let d = out[i];
      if (d === 0 || o === 0 || o === WATER_OWNER) continue;
      const left = x > wx0;
      if (left && owner[t - 1] === o && out[i - 1] + 1 < d) d = out[i - 1] + 1;
      if (up) {
        const u = t - width;
        const j = i - ww;
        if (owner[u] === o && out[j] + 1 < d) d = out[j] + 1;
        if (left && owner[u - 1] === o && out[j - 1] + DIAGONAL < d) d = out[j - 1] + DIAGONAL;
        if (x < wx1 - 1 && owner[u + 1] === o && out[j + 1] + DIAGONAL < d) d = out[j + 1] + DIAGONAL;
      }
      out[i] = d;
    }
  }
  // backward pass: right, down-right, down, down-left
  for (let y = wy1 - 1; y >= wy0; y--) {
    const down = y < wy1 - 1;
    let i = (y - wy0) * ww + (ww - 1);
    for (let x = wx1 - 1, t = y * width + wx1 - 1; x >= wx0; x--, t--, i--) {
      const o = owner[t];
      let d = out[i];
      if (d === 0 || o === 0 || o === WATER_OWNER) continue;
      const right = x < wx1 - 1;
      if (right && owner[t + 1] === o && out[i + 1] + 1 < d) d = out[i + 1] + 1;
      if (down) {
        const b = t + width;
        const j = i + ww;
        if (owner[b] === o && out[j] + 1 < d) d = out[j] + 1;
        if (right && owner[b + 1] === o && out[j + 1] + DIAGONAL < d) d = out[j + 1] + DIAGONAL;
        if (x > wx0 && owner[b - 1] === o && out[j - 1] + DIAGONAL < d) d = out[j - 1] + DIAGONAL;
      }
      out[i] = d;
    }
  }
}
