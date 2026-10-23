import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../shared/types';
import { flashesFor, lossCells, mergeFlashes, minimapSize, minimapToTile, viewBox } from './minimapGeometry';
import type { Flash } from './minimapGeometry';

describe('minimap geometry', () => {
  it("fits the map's shape inside 240×160", () => {
    expect(minimapSize(1500, 567)).toEqual({ w: 240, h: 91, scale: 0.16 });
    expect(minimapSize(400, 250)).toEqual({ w: 240, h: 150, scale: 0.6 });
    expect(minimapSize(100, 300)).toMatchObject({ h: 160, w: 53 });
  });

  it("the view box covers the camera's part of the map, clipped to the minimap", () => {
    const size = minimapSize(400, 250);
    expect(viewBox({ x: 100, y: 50, zoom: 2 }, 800, 600, size)).toEqual({ x: 60, y: 30, w: 180, h: 120 });
    const off = viewBox({ x: -50, y: -20, zoom: 4 }, 800, 600, size);
    expect(off.x).toBe(0);
    expect(off.y).toBe(0);
    expect(off.w).toBeCloseTo(90, 9);
    expect(off.h).toBeCloseTo(78, 9);
  });

  it('minimapToTile undoes the scale', () => {
    const size = minimapSize(400, 250);
    expect(minimapToTile(120, 75, size)).toEqual({ x: 200, y: 125 });
  });

  it('lossCells groups lost tiles into 24-tile cells, biggest first, at most 12', () => {
    const width = 100;
    const at = (x: number, y: number): number => y * width + x;
    // one tile in the cell at (0, 0); three around (30, 30), in the cell at (24, 24)
    const cells = lossCells([at(2, 2), at(30, 30), at(31, 30), at(32, 33)], width);
    expect(cells).toEqual([{ x: 31.5, y: 31.5 }, { x: 2.5, y: 2.5 }]);
    const many = Array.from({ length: 20 }, (_, i) => at((i % 4) * 24, Math.floor(i / 4) * 24));
    expect(lossCells(many, width)).toHaveLength(12);
  });

  it('flashesFor: red where the player lost land or was bombed, orange where the player bombed, nothing else', () => {
    const width = 100;
    const events: GameEvent[] = [
      { type: 'bombed', by: 2, owner: 1, tile: 5 * width + 6 },
      { type: 'bombed', by: 1, owner: 3, tile: 7 * width + 8 },
      { type: 'bombed', by: 2, owner: 3, tile: 9 * width + 9 },
      { type: 'attackStarted', attacker: 2, target: 1, troops: 5 },
    ];
    expect(flashesFor(events, [40 * width + 40], 1, width, 1000)).toEqual([
      { x: 40.5, y: 40.5, kind: 'danger', start: 1000 },
      { x: 6.5, y: 5.5, kind: 'danger', start: 1000 },
      { x: 8.5, y: 7.5, kind: 'bomb', start: 1000 },
    ]);
  });

  it('mergeFlashes keeps one live ring per cell and kind, so a long attack cannot push other rings out', () => {
    const bomb: Flash = { x: 200.5, y: 100.5, kind: 'bomb', start: 0 };
    let flashes = mergeFlashes([], [bomb], 0, 1500, 12);
    // a second of losses in three cells, ten updates a second, each a little apart inside its cell
    for (let t = 100; t <= 1000; t += 100) {
      const losses = [30, 80, 130].map((x): Flash => ({ x: x + (t % 7), y: 10.5, kind: 'danger', start: t }));
      flashes = mergeFlashes(flashes, losses, t, 1500, 12);
    }
    expect(flashes).toContainEqual(bomb);
    expect(flashes.filter((f) => f.kind === 'danger').map((f) => f.start)).toEqual([100, 100, 100]);
    // once a ring has faded, the next loss there starts a new one
    flashes = mergeFlashes(flashes, [{ x: 31.5, y: 10.5, kind: 'danger', start: 1700 }], 1700, 1500, 12);
    expect(flashes).toEqual([{ x: 31.5, y: 10.5, kind: 'danger', start: 1700 }]);
  });

  it('mergeFlashes keeps at most `max`, the newest', () => {
    const far = (i: number): Flash => ({ x: i * 100 + 0.5, y: 0.5, kind: 'danger', start: i });
    const flashes = mergeFlashes([far(0), far(1)], [far(2), far(3)], 3, 1500, 3);
    expect(flashes.map((f) => f.start)).toEqual([1, 2, 3]);
  });
});
