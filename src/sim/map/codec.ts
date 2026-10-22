import { createGameMap } from './gameMap';
import type { GameMap } from './gameMap';

const MAGIC = [0x57, 0x4d, 0x41, 0x50]; // "WMAP"
const VERSION = 1;
const HEADER_BYTES = 9; // magic(4) + version(1) + width(2) + height(2)
const RUN_BYTES = 3; // terrain(1) + run length(2)
const MAX_RUN = 0xffff;
const MAX_DIMENSION = 0xffff;

/** Serialises a map as `WMAP`, u8 version, u16 width, u16 height (little-endian), then (u8 terrain, u16 run) pairs. */
export function encodeMap(map: GameMap): Uint8Array {
  const { width, height, terrain } = map;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`Map ${width}x${height} exceeds the WMAP limit of ${MAX_DIMENSION} per side`);
  }

  const runTerrain: number[] = [];
  const runLength: number[] = [];
  for (let t = 0; t < terrain.length; t++) {
    const last = runTerrain.length - 1;
    if (last >= 0 && runTerrain[last] === terrain[t] && runLength[last] < MAX_RUN) {
      runLength[last]++;
    } else {
      runTerrain.push(terrain[t]);
      runLength.push(1);
    }
  }

  const bytes = new Uint8Array(HEADER_BYTES + runTerrain.length * RUN_BYTES);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  view.setUint8(4, VERSION);
  view.setUint16(5, width, true);
  view.setUint16(7, height, true);
  let offset = HEADER_BYTES;
  for (let i = 0; i < runTerrain.length; i++) {
    view.setUint8(offset, runTerrain[i]);
    view.setUint16(offset + 1, runLength[i], true);
    offset += RUN_BYTES;
  }
  return bytes;
}

export function decodeMap(bytes: Uint8Array): GameMap {
  if (bytes.length < HEADER_BYTES || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error('Not a WMAP file: bad magic');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(4);
  if (version !== VERSION) {
    throw new Error(`Unsupported WMAP version ${version} (expected ${VERSION})`);
  }
  const width = view.getUint16(5, true);
  const height = view.getUint16(7, true);
  if ((bytes.length - HEADER_BYTES) % RUN_BYTES !== 0) {
    throw new Error('Corrupt WMAP file: truncated run-length pair');
  }

  const total = width * height;
  const terrain = new Uint8Array(total);
  let filled = 0;
  for (let offset = HEADER_BYTES; offset < bytes.length; offset += RUN_BYTES) {
    const value = view.getUint8(offset);
    const run = view.getUint16(offset + 1, true);
    if (filled + run > total) {
      throw new Error(`Corrupt WMAP file: run-length total exceeds ${width}x${height} = ${total} tiles`);
    }
    terrain.fill(value, filled, filled + run);
    filled += run;
  }
  if (filled !== total) {
    throw new Error(`Corrupt WMAP file: run-length total ${filled} does not match ${width}x${height} = ${total} tiles`);
  }
  return createGameMap(width, height, terrain);
}
