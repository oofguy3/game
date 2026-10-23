import { describe, expect, it } from 'vitest';
import { Terrain } from '../../shared/types';
import { shade, TERRAIN_COLORS, toPixel } from './palette';
import { TerritoryLayer } from './territoryLayer';

const RED = 0xd31717;
const BLUE = 0x3b82f6;

describe('TerritoryLayer', () => {
  // 4×3: a plains row, a hills row, then water
  const terrain = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2, 0, 0, 0, 0]);

  it('starts with the terrain colours and everything dirty', () => {
    const layer = new TerritoryLayer(4, 3, terrain, new Map());
    expect(layer.pixels[0]).toBe(toPixel(TERRAIN_COLORS[Terrain.Plains]));
    expect(layer.pixels[4]).toBe(toPixel(TERRAIN_COLORS[Terrain.Hills]));
    expect(layer.pixels[8]).toBe(toPixel(TERRAIN_COLORS[Terrain.Water]));
    expect(layer.dirty).toEqual({ x0: 0, y0: 0, x1: 3, y1: 2 });
  });

  it('territory layer shades borders and shows terrain for unowned land', () => {
    const layer = new TerritoryLayer(4, 3, terrain, new Map([[1, RED], [2, BLUE]]));
    layer.dirty = null;
    const owner = new Uint16Array(12);
    // nation 1 holds the left two columns of land, nation 2 the top right tile
    for (const t of [0, 1, 4, 5]) owner[t] = 1;
    owner[3] = 2;
    layer.applyTiles(owner, [0, 1, 4, 5, 3]);
    // tile 0: inside on the map edge, only own neighbours and the edge → full colour
    expect(layer.pixels[0]).toBe(toPixel(RED));
    // tile 1 touches unowned tile 2 → border shade
    expect(layer.pixels[1]).toBe(toPixel(shade(RED, 0.6)));
    // tile 4 touches water below → border shade
    expect(layer.pixels[4]).toBe(toPixel(shade(RED, 0.6)));
    // tile 3 (nation 2) touches unowned 2 and 7 → border
    expect(layer.pixels[3]).toBe(toPixel(shade(BLUE, 0.6)));
    // unowned land shows its terrain
    expect(layer.pixels[2]).toBe(toPixel(TERRAIN_COLORS[Terrain.Plains]));
    expect(layer.pixels[6]).toBe(toPixel(TERRAIN_COLORS[Terrain.Hills]));
    expect(layer.dirty).toEqual({ x0: 0, y0: 0, x1: 3, y1: 2 });
  });

  it('repaints neighbours whose border status changed', () => {
    const layer = new TerritoryLayer(4, 3, terrain, new Map([[1, RED]]));
    const owner = new Uint16Array(12);
    owner[0] = 1;
    layer.applyTiles(owner, [0]);
    expect(layer.pixels[0]).toBe(toPixel(shade(RED, 0.6)));
    // tile 1 joins: tile 0 is no longer on a border of nation 1 with anything but its own land and the edge… except 4
    owner[1] = 1;
    owner[4] = 1;
    owner[5] = 1;
    layer.dirty = null;
    layer.applyTiles(owner, [1, 4, 5]);
    expect(layer.pixels[0]).toBe(toPixel(RED));
    expect(layer.dirty).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });
  });
});

describe('palette', () => {
  it('shade scales each channel and clamps', () => {
    expect(shade(0x808080, 0.5)).toBe(0x404040);
    expect(shade(0x808080, 3)).toBe(0xffffff);
  });

  it('toPixel packs RGB as opaque little-endian RGBA', () => {
    expect(toPixel(0x112233)).toBe((0xff000000 | (0x33 << 16) | (0x22 << 8) | 0x11) >>> 0);
  });
});
