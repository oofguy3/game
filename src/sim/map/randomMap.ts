import { createNoise2D } from 'simplex-noise';
import type { NoiseFunction2D } from 'simplex-noise';
import { CONFIG } from '../../shared/config';
import type { MapSize } from '../../shared/types';
import { Terrain } from '../../shared/types';
import { Rng } from '../util/rng';
import { createGameMap } from './gameMap';
import type { GameMap } from './gameMap';

/** Tiles at the map edge that are always water. */
const BORDER_WIDTH = 4;

/** Shape of the height field used to place land. */
const HEIGHT = {
  octaves: 5,
  /** First-octave frequency, in noise cycles per map width. */
  cyclesAcrossWidth: 3,
  /** Continent centres are drawn from this inner part of the map (fractions of width / height). */
  centreRange: [0.2, 0.8],
  continents: [3, 6],
  /** Bump height range (the fBm field spans roughly -1..1). */
  bumpHeight: [0.6, 1.2],
  /** Bump standard deviation range, as a fraction of the shorter map side. */
  bumpSigma: [0.1, 0.2],
  /** The falloff starts this far from the edge (fraction of the shorter map side) and ends at the edge. */
  falloffReach: 0.15,
  /** Height subtracted at the very edge; deep enough to keep the border below the land threshold. */
  falloffDepth: 3,
} as const;

/** Shape of the noise field that ranks land tiles for hills and mountains. */
const RELIEF = {
  octaves: 4,
  cyclesAcrossWidth: 6,
  mountainShare: 0.12,
  hillShare: 0.23,
} as const;

const PERSISTENCE = 0.5;
const LACUNARITY = 2;

/** Fractal Brownian motion: summed octaves of `noise`, normalised to roughly -1..1. */
function fbm(noise: NoiseFunction2D, x: number, y: number, octaves: number, baseFrequency: number): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = baseFrequency;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * noise(x * frequency, y * frequency);
    total += amplitude;
    amplitude *= PERSISTENCE;
    frequency *= LACUNARITY;
  }
  return sum / total;
}

function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Per-axis gaussian profile; a 2D gaussian bump is the product of its x and y profiles. */
function gaussianProfile(length: number, centre: number, sigma: number): Float32Array {
  const profile = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const d = (i - centre) / sigma;
    profile[i] = Math.exp(-0.5 * d * d);
  }
  return profile;
}

/**
 * Height field: fBm plus gaussian bumps at random continent centres, minus an edge falloff.
 * `noiseRng` seeds the fBm noise and `centreRng` places the continents, so the two are independent.
 */
function buildHeightField(width: number, height: number, noiseRng: Rng, centreRng: Rng): Float32Array {
  const noise = createNoise2D(() => noiseRng.next());
  const field = new Float32Array(width * height);
  const baseFrequency = HEIGHT.cyclesAcrossWidth / width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      field[y * width + x] = fbm(noise, x, y, HEIGHT.octaves, baseFrequency);
    }
  }

  const shorterSide = Math.min(width, height);
  const lerp = (range: readonly [number, number]): number => range[0] + centreRng.next() * (range[1] - range[0]);
  const continents = centreRng.int(HEIGHT.continents[0], HEIGHT.continents[1]);
  for (let c = 0; c < continents; c++) {
    const centreX = lerp(HEIGHT.centreRange) * width;
    const centreY = lerp(HEIGHT.centreRange) * height;
    const sigma = lerp(HEIGHT.bumpSigma) * shorterSide;
    const bumpHeight = lerp(HEIGHT.bumpHeight);
    const profileX = gaussianProfile(width, centreX, sigma);
    const profileY = gaussianProfile(height, centreY, sigma);
    for (let y = 0; y < height; y++) {
      const rowHeight = bumpHeight * profileY[y];
      for (let x = 0; x < width; x++) field[y * width + x] += rowHeight * profileX[x];
    }
  }

  const reach = HEIGHT.falloffReach * shorterSide;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edgeDistance = Math.min(x, y, width - 1 - x, height - 1 - y);
      field[y * width + x] -= HEIGHT.falloffDepth * (1 - smoothstep(0, reach, edgeDistance));
    }
  }
  return field;
}

/** The value at fraction `q` (0..1) of the ascending-sorted `values`. */
function quantile(values: Float32Array, q: number): number {
  const sorted = values.slice().sort();
  return sorted[Math.floor(q * sorted.length)];
}

/** Value at ascending-sorted `sorted[length - count]`: the smallest value among the top `count`. */
function topThreshold(sorted: Float32Array, count: number): number {
  return count > 0 ? sorted[sorted.length - count] : Infinity;
}

/**
 * Adds relief to land: ranks land tiles by a noise field of their own, the top 12% become
 * Mountains and the next 23% Hills; the rest stay as they are. Water tiles are never touched.
 */
export function applyRelief(terrain: Uint8Array, width: number, height: number, rng: Rng): void {
  const noise = createNoise2D(() => rng.next());
  const baseFrequency = RELIEF.cyclesAcrossWidth / width;

  const landTiles = new Int32Array(terrain.length);
  const relief = new Float32Array(terrain.length);
  let landCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = y * width + x;
      if (terrain[t] === Terrain.Water) continue;
      landTiles[landCount] = t;
      relief[landCount] = fbm(noise, x, y, RELIEF.octaves, baseFrequency);
      landCount++;
    }
  }

  const sorted = relief.slice(0, landCount).sort();
  const mountains = Math.round(landCount * RELIEF.mountainShare);
  const hills = Math.round(landCount * RELIEF.hillShare);
  const mountainThreshold = topThreshold(sorted, mountains);
  const hillThreshold = topThreshold(sorted, mountains + hills);

  for (let i = 0; i < landCount; i++) {
    if (relief[i] >= mountainThreshold) terrain[landTiles[i]] = Terrain.Mountains;
    else if (relief[i] >= hillThreshold) terrain[landTiles[i]] = Terrain.Hills;
  }
}

/** Deterministic random continents: the same (seed, size) always yields the same map. */
export function generateRandomMap(seed: number, size: MapSize): GameMap {
  const [width, height] = CONFIG.map.sizes[size];
  const rng = new Rng(seed);

  const field = buildHeightField(width, height, rng.fork(1), rng.fork(2));
  const threshold = quantile(field, 1 - CONFIG.map.landFraction);

  // Land is everything at or above the threshold; the border rows and columns are skipped, so they stay water.
  const terrain = new Uint8Array(width * height);
  for (let y = BORDER_WIDTH; y < height - BORDER_WIDTH; y++) {
    for (let x = BORDER_WIDTH; x < width - BORDER_WIDTH; x++) {
      const t = y * width + x;
      if (field[t] >= threshold) terrain[t] = Terrain.Plains;
    }
  }

  applyRelief(terrain, width, height, rng.fork(3));
  return createGameMap(width, height, terrain);
}
