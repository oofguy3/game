import { describe, expect, it } from 'vitest';
import { Terrain } from '../../shared/types';
import { mapFromAscii } from '../testing/asciiMap';
import { decodeMap, encodeMap } from './codec';
import { createGameMap } from './gameMap';

// 4 land tiles (two plains in row 1, plains + hills in row 2), 12 water tiles.
const m = mapFromAscii(['....', '.##.', '.#^.', '....']);

describe('map codec', () => {
  it('codec round-trips', () => {
    const d = decodeMap(encodeMap(m));
    expect([d.width, d.height]).toEqual([4, 4]);
    expect([...d.terrain]).toEqual([...m.terrain]);
  });

  it('rebuilds derived data on decode', () => {
    const d = decodeMap(encodeMap(m));
    expect(d.landCount).toBe(4);
    expect(d.waterBodySize).toEqual([12]);
    expect(d.landmassSize).toEqual([4]);
  });

  it('writes the documented header and run-length pairs', () => {
    const bytes = encodeMap(mapFromAscii(['..#', '##M']));
    expect([...bytes]).toEqual([
      0x57, 0x4d, 0x41, 0x50, // "WMAP"
      1,                      // version
      3, 0, 2, 0,             // width, height (u16 LE)
      Terrain.Water, 2, 0,
      Terrain.Plains, 3, 0,
      Terrain.Mountains, 1, 0,
    ]);
  });

  it('splits runs longer than 65535 and round-trips them', () => {
    const w = 700;
    const h = 200; // 140000 tiles
    const terrain = new Uint8Array(w * h);
    terrain[w * h - 1] = Terrain.Hills;
    const big = createGameMap(w, h, terrain);
    const bytes = encodeMap(big);
    expect(bytes.length).toBe(9 + 3 * 4);
    const d = decodeMap(bytes);
    expect([d.width, d.height]).toEqual([w, h]);
    expect(d.terrain).toEqual(terrain);
  });

  it('round-trips a pseudo-random map', () => {
    const w = 37;
    const h = 23;
    const terrain = new Uint8Array(w * h);
    let s = 12345;
    for (let i = 0; i < terrain.length; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      terrain[i] = (s >>> 16) & 3;
    }
    const d = decodeMap(encodeMap(createGameMap(w, h, terrain)));
    expect(d.terrain).toEqual(terrain);
  });

  it('codec rejects bad magic', () => expect(() => decodeMap(new Uint8Array(10))).toThrow(/WMAP/));

  it('rejects input shorter than the header', () => expect(() => decodeMap(new Uint8Array([0x57, 0x4d]))).toThrow(/WMAP/));

  it('rejects an unsupported version', () => {
    const bytes = encodeMap(m);
    bytes[4] = 2;
    expect(() => decodeMap(bytes)).toThrow(/version/);
  });

  it('rejects a run-length total that does not match width x height', () => {
    const bytes = encodeMap(m);
    expect(() => decodeMap(bytes.slice(0, bytes.length - 3))).toThrow(/run/);
    const longer = new Uint8Array(bytes.length + 3);
    longer.set(bytes);
    longer.set([Terrain.Water, 1, 0], bytes.length);
    expect(() => decodeMap(longer)).toThrow(/run/);
  });

  it('rejects a truncated run pair', () => {
    const bytes = encodeMap(m);
    expect(() => decodeMap(bytes.slice(0, bytes.length - 1))).toThrow();
  });
});
