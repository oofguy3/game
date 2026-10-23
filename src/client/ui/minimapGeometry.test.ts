import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../shared/types';
import { flashesFor, lossCells, minimapSize, minimapToTile, viewBox } from './minimapGeometry';

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
});
