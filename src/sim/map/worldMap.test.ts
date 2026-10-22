import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Terrain } from '../../shared/types';
import { decodeWorldMap, lonLatToTile, WORLD_PROJECTION } from './worldMap';
import { encodeMap } from './codec';
import { createGameMap } from './gameMap';

const map = decodeWorldMap(new Uint8Array(readFileSync('public/maps/world.bin')));

describe('world map asset', () => {
  it('matches the projection', () => expect([map.width, map.height]).toEqual([1500, 567]));

  it.each([[2.35, 48.85], [10, 23], [134, -25], [-100, 40], [78, 22], [-60, -10]])('land at %s,%s', (lon, lat) =>
    expect(map.terrain[lonLatToTile(lon, lat)]).not.toBe(Terrain.Water));

  it.each([[-30, 30], [-150, 0], [0, 0], [70, -20], [160, 30]])('water at %s,%s', (lon, lat) =>
    expect(map.terrain[lonLatToTile(lon, lat)]).toBe(Terrain.Water));

  it('land share is 25–45%', () => {
    const f = map.landCount / (map.width * map.height);
    expect(f).toBeGreaterThan(0.25);
    expect(f).toBeLessThan(0.45);
  });

  it('file is under 300 KB', () => expect(statSync('public/maps/world.bin').size).toBeLessThan(300_000));
});

describe('lonLatToTile', () => {
  const { width, height, latMax, latMin } = WORLD_PROJECTION;

  it('maps the corners of the projected area to the corner tiles', () => {
    expect(lonLatToTile(-180, latMax)).toBe(0);
    expect(lonLatToTile(179.99, latMin + 0.01)).toBe(width * height - 1);
  });

  it('clamps out-of-range coordinates into the map', () => {
    expect(lonLatToTile(180, latMin)).toBe(width * height - 1);
    expect(lonLatToTile(-200, 90)).toBe(0);
  });
});

describe('decodeWorldMap', () => {
  it('rejects a map whose size differs from the projection', () => {
    const wrong = createGameMap(10, 5, new Uint8Array(50));
    expect(() => decodeWorldMap(encodeMap(wrong))).toThrow(/1500x567/);
  });
});
