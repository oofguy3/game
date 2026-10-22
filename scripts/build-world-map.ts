import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { Terrain } from '../src/shared/types';
import { encodeMap } from '../src/sim/map/codec';
import { createGameMap } from '../src/sim/map/gameMap';
import { applyRelief } from '../src/sim/map/randomMap';
import { WORLD_PROJECTION } from '../src/sim/map/worldMap';
import { Rng } from '../src/sim/util/rng';

const RELIEF_SEED = 1337;
const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/maps/world.bin');

type Ring = Position[];

function loadLandRings(): Ring[] {
  const require = createRequire(import.meta.url);
  const topology = JSON.parse(readFileSync(require.resolve('world-atlas/land-50m.json'), 'utf8')) as Topology;
  const land: Feature | FeatureCollection = feature(topology, topology.objects.land as GeometryCollection);

  const rings: Ring[] = [];
  const addGeometry = (geometry: Geometry | null): void => {
    if (!geometry) return;
    if (geometry.type === 'Polygon') rings.push(...geometry.coordinates);
    else if (geometry.type === 'MultiPolygon') for (const polygon of geometry.coordinates) rings.push(...polygon);
    else if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(addGeometry);
  };
  for (const f of land.type === 'FeatureCollection' ? land.features : [land]) addGeometry(f.geometry);
  return rings;
}

/**
 * Scanline fill, even-odd across every ring (so lakes and holes come out as water): for each row the crossings of
 * all ring edges at the row-centre latitude are sorted, and tiles whose centre longitude lies between a pair are land.
 */
function rasterize(rings: Ring[]): Uint8Array {
  const { width, height, latMax, latMin } = WORLD_PROJECTION;
  const terrain = new Uint8Array(width * height);
  const crossings: number[] = [];

  for (let y = 0; y < height; y++) {
    const lat = latMax - ((y + 0.5) * (latMax - latMin)) / height;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[i + 1];
        if (lat1 > lat !== lat2 > lat) crossings.push(lon1 + ((lat - lat1) * (lon2 - lon1)) / (lat2 - lat1));
      }
    }
    crossings.sort((a, b) => a - b);

    // An odd trailing crossing has no partner and is ignored.
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      // First and one-past-last tile whose centre longitude, -180 + (x + 0.5) * 360 / width, is in [start, end).
      const first = Math.max(0, Math.ceil(((crossings[i] + 180) / 360) * width - 0.5));
      const end = Math.min(width, Math.ceil(((crossings[i + 1] + 180) / 360) * width - 0.5));
      if (first < end) terrain.fill(Terrain.Plains, y * width + first, y * width + end);
    }
  }
  return terrain;
}

const { width, height } = WORLD_PROJECTION;
const terrain = rasterize(loadLandRings());
applyRelief(terrain, width, height, new Rng(RELIEF_SEED));
const map = createGameMap(width, height, terrain);

const bytes = encodeMap(map);
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, bytes);
console.log(
  `Wrote ${OUTPUT}: ${width}x${height}, ${bytes.length} bytes, land share ${((100 * map.landCount) / (width * height)).toFixed(1)}%`,
);
