import { createNoise2D } from 'simplex-noise';
import { Terrain } from '../../../shared/types';
import { Rng } from '../../../sim/util/rng';
import type { LookOptions } from '../../../worker/protocol';

/** The signed coast distance is kept within ±this many tiles. */
export const COAST_RANGE = 8;
/** Forests stay at least this far (tiles) from the coastline, leaving the beaches bare. */
const FOREST_COAST_GAP = 1.5;
/** Base height of each terrain type before noise and smoothing. */
const BASE_HEIGHT = [0, 0.2, 0.5, 0.9];
const HEIGHT_NOISE = 0.08;
const BLUR_RADIUS = 2;
/** Mountains whose smoothed height reaches this get a snow cap at any latitude. */
const SNOW_CAP_HEIGHT = 0.72;
/** Snow ramps from none at SNOW_FROM° to full at SNOW_FULL°. */
const SNOW_FROM = 58;
const SNOW_FULL = 68;
/** How strongly slopes brighten or darken the hill shade. */
const SHADE_STRENGTH = 160;
const INF = 1e20;

/**
 * What the map looks like, worked out once from the terrain: one byte per tile each for the signed coast distance and
 * the hill shade, and RGBA per tile for forest, dryness, snow and rock (0 plains or water, 128 hills, 255 mountains).
 */
export interface TerrainLook {
  width: number;
  height: number;
  coast: Uint8Array;
  shade: Uint8Array;
  biome: Uint8Array;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Signed coast distance `s` (tiles, positive on land) as one byte. */
export function encodeCoast(s: number): number {
  return Math.round(((clamp(s, -COAST_RANGE, COAST_RANGE) + COAST_RANGE) / (2 * COAST_RANGE)) * 255);
}

export function decodeCoast(b: number): number {
  return (b / 255) * 2 * COAST_RANGE - COAST_RANGE;
}

/**
 * The look of a `width`×`height` map: smooth coasts, hill shading lit from the top-left, forests, dry land, and snow
 * by latitude and on high peaks. Deterministic: the noise is seeded from `look.seed`.
 */
export function buildTerrainLook(width: number, height: number, terrain: Uint8Array, look: LookOptions): TerrainLook {
  const n = width * height;
  const rng = new Rng(look.seed);
  const random = (): number => rng.next();
  const heightNoise = createNoise2D(random);
  const dryNoise = createNoise2D(random);
  const forestNoise = createNoise2D(random);
  const forestDetail = createNoise2D(random);

  // signed distance to the coastline: land measures to the nearest water, water to the nearest land
  const toWater = distances(width, height, (t) => terrain[t] === Terrain.Water);
  const toLand = distances(width, height, (t) => terrain[t] !== Terrain.Water);
  const coastDistance = new Float32Array(n);
  const coast = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    const s = terrain[t] === Terrain.Water ? -(toLand[t] - 0.5) : toWater[t] - 0.5;
    coastDistance[t] = clamp(s, -COAST_RANGE, COAST_RANGE);
    coast[t] = encodeCoast(s);
  }

  // a smoothed height field for the shading and the snow caps
  const heights = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    const x = t % width;
    const y = (t - x) / width;
    const land = terrain[t] !== Terrain.Water;
    heights[t] = BASE_HEIGHT[terrain[t]] + (land ? heightNoise(x / 12, y / 12) * HEIGHT_NOISE : 0);
  }
  boxBlur(heights, width, height, BLUR_RADIUS);
  boxBlur(heights, width, height, BLUR_RADIUS);

  const shade = new Uint8Array(n);
  const biome = new Uint8Array(4 * n);
  const { top, bottom } = look.latitude;
  for (let y = 0; y < height; y++) {
    const lat = Math.abs(top + ((bottom - top) * (y + 0.5)) / height);
    const latSnow = clamp((lat - SNOW_FROM) / (SNOW_FULL - SNOW_FROM), 0, 1);
    const band = smoothstep(12, 20, lat) * (1 - smoothstep(30, 38, lat));
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      const kind = terrain[t];
      if (kind === Terrain.Water) {
        shade[t] = 128;
        continue;
      }
      // slopes rising toward the bottom-right face the light in the top-left
      const dx = heights[y * width + Math.min(width - 1, x + 1)] - heights[y * width + Math.max(0, x - 1)];
      const dy = heights[Math.min(height - 1, y + 1) * width + x] - heights[Math.max(0, y - 1) * width + x];
      shade[t] = Math.round(clamp(128 + (dx + dy) * SHADE_STRENGTH, 0, 255));

      const snow = kind === Terrain.Mountains && heights[t] >= SNOW_CAP_HEIGHT ? 1 : latSnow;
      const dryRaw = dryNoise(x / 40, y / 40);
      let dry = look.dryBands ? clamp(band * 0.85 + (dryRaw - 0.1) * 0.35, 0, 1) : clamp((dryRaw - 0.35) * 1.5, 0, 1);
      if (snow > 0.5) dry = 0;
      let forest = 0;
      if ((kind === Terrain.Plains || kind === Terrain.Hills) && coastDistance[t] >= FOREST_COAST_GAP && snow < 0.3) {
        const f = forestNoise(x / 18, y / 18) * 0.7 + forestDetail(x / 6, y / 6) * 0.3;
        forest = clamp((f + 0.1 - dry * 0.9) * 2.2, 0, 1);
      }
      biome[4 * t] = Math.round(forest * 255);
      biome[4 * t + 1] = Math.round(dry * 255);
      biome[4 * t + 2] = Math.round(snow * 255);
      biome[4 * t + 3] = kind === Terrain.Mountains ? 255 : kind === Terrain.Hills ? 128 : 0;
    }
  }
  return { width, height, coast, shade, biome };
}

/** Euclidean distance (tiles) from each tile's centre to the nearest tile where `source` holds; INF-ish when none. */
function distances(width: number, height: number, source: (t: number) => boolean): Float64Array {
  const n = width * height;
  const grid = new Float64Array(n);
  for (let t = 0; t < n; t++) grid[t] = source(t) ? 0 : INF;
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  // columns, then rows (Felzenszwalb–Huttenlocher squared distance transform)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
  }
  for (let t = 0; t < n; t++) grid[t] = Math.sqrt(grid[t]);
  return grid;
}

/** One-dimensional squared distance transform of `f` (length `n`) into `d`, using `v` and `z` as scratch. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Blurs `values` in place with a (2r+1)-wide box, rows then columns, clamping at the edges. */
function boxBlur(values: Float32Array, width: number, height: number, r: number): void {
  const line = new Float32Array(Math.max(width, height));
  const span = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) line[x] = values[y * width + x];
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += line[clamp(x + k, 0, width - 1)];
      values[y * width + x] = sum / span;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) line[y] = values[y * width + x];
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += line[clamp(y + k, 0, height - 1)];
      values[y * width + x] = sum / span;
    }
  }
}
