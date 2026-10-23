import { describe, expect, it } from 'vitest';
import { Rng } from '../../../sim/util/rng';
import { BLOCK, EDGE_MAX, fullEdge, NEVER, TerritoryField, WATER_OWNER } from './territoryField';

/** A `width`×`height` map: water where `water(x, y)`, plains elsewhere. */
function map(width: number, height: number, water: (x: number, y: number) => boolean = () => false) {
  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) terrain[y * width + x] = water(x, y) ? 0 : 1;
  const owner = new Uint16Array(width * height);
  const field = new TerritoryField(width, height, terrain);
  const at = (x: number, y: number): number => y * width + x;
  /** Sets owners and tells the field, as one update. */
  const set = (changes: [number, number][], now = 1): void => {
    for (const [t, o] of changes) owner[t] = o;
    field.apply(owner, changes.map(([t]) => t), now);
  };
  return { terrain, owner, field, at, set };
}

describe('TerritoryField', () => {
  it('water holds WATER_OWNER and owned land holds its nation', () => {
    const m = map(4, 1, (x) => x === 0);
    expect([...m.field.owner]).toEqual([WATER_OWNER, 0, 0, 0]);
    m.set([[1, 3], [2, 7]]);
    expect([...m.field.owner]).toEqual([WATER_OWNER, 3, 7, 0]);
  });

  it('captured records when each tile last changed owner; the rest stay NEVER', () => {
    const m = map(3, 1);
    m.set([[0, 1]], 5);
    m.set([[1, 1]], 6.5);
    m.set([[0, 2]], 8);
    expect([...m.field.captured]).toEqual([8, 6.5, NEVER]);
  });

  it('edge is 0 on a border, 64 one tile in, 255 from four tiles in and on unowned land', () => {
    const m = map(20, 5);
    const changes: [number, number][] = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 20; x++) changes.push([m.at(x, y), x < 10 ? 1 : 2]);
    m.set(changes);
    expect(m.field.edge[m.at(9, 2)]).toBe(0);
    expect(m.field.edge[m.at(10, 2)]).toBe(0);
    expect(m.field.edge[m.at(8, 2)]).toBe(64);
    expect(m.field.edge[m.at(5, 2)]).toBe(255);
    expect(EDGE_MAX).toBe(4);
    const empty = map(6, 1);
    empty.set([[0, 1], [1, 1]]);
    // nation 1 meets empty land at tile 1; the empty land itself has no glow
    expect([...empty.field.edge]).toEqual([64, 0, 255, 255, 255, 255]);
  });

  it('a coast is not a border: owned land beside water only has full edge', () => {
    const m = map(10, 3, (x) => x === 0);
    const changes: [number, number][] = [];
    for (let y = 0; y < 3; y++) for (let x = 1; x < 10; x++) changes.push([m.at(x, y), 1]);
    m.set(changes);
    expect([...m.field.edge].every((e) => e === 255)).toBe(true);
  });

  it('after many random updates, edge equals a full recompute', () => {
    const m = map(100, 80, (x, y) => (x * 7 + y * 13) % 23 < 3);
    const land: number[] = [];
    for (let t = 0; t < m.terrain.length; t++) if (m.terrain[t] !== 0) land.push(t);
    const rng = new Rng(7);
    for (let round = 0; round < 40; round++) {
      const count = rng.int(1, 400);
      const changes: [number, number][] = [];
      for (let i = 0; i < count; i++) changes.push([land[rng.int(0, land.length - 1)], rng.int(0, 5)]);
      m.set(changes, round);
      expect([...m.field.edge]).toEqual([...fullEdge(100, 80, m.field.owner)]);
    }
  });

  it('takeDirty returns each touched block once, clamped to the map, then nothing', () => {
    const m = map(70, 40);
    expect(m.field.takeDirty()).toEqual([]);
    m.set([[m.at(66, 39), 1]]);
    m.set([[m.at(67, 38), 1]]);
    expect(BLOCK).toBe(32);
    expect(m.field.takeDirty()).toEqual([{ x: 32, y: 32, w: 32, h: 8 }, { x: 64, y: 32, w: 6, h: 8 }]);
    expect(m.field.takeDirty()).toEqual([]);
  });
});
