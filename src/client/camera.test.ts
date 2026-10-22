import { describe, expect, it } from 'vitest';
import { Camera } from './camera';

describe('Camera', () => {
  it('camera screen↔tile round-trips', () => {
    const cam = new Camera(800, 600, 400, 250);
    cam.zoomAt(123, 45, 3.7);
    cam.pan(-40, 25);
    for (const [sx, sy] of [[0, 0], [400, 300], [799, 599], [17.5, 342.25]]) {
      const t = cam.screenToTile(sx, sy);
      const back = cam.tileToScreen(t.x, t.y);
      expect(back.x).toBeCloseTo(sx, 9);
      expect(back.y).toBeCloseTo(sy, 9);
    }
  });

  it('zoomAt keeps the point under the cursor', () => {
    const cam = new Camera(800, 600, 400, 250);
    cam.fitMap();
    const before = cam.screenToTile(300, 200);
    cam.zoomAt(300, 200, 2);
    const after = cam.screenToTile(300, 200);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('zoom is clamped', () => {
    const cam = new Camera(800, 600, 400, 250);
    cam.zoomAt(400, 300, 1e6);
    expect(cam.zoom).toBe(32);
    cam.zoomAt(400, 300, 1e-6);
    expect(cam.zoom).toBe(0.5);
  });

  it('fitMap shows the whole map, centred', () => {
    const cam = new Camera(800, 600, 400, 250);
    cam.fitMap();
    expect(cam.zoom).toBeCloseTo(2, 9); // 800 / 400 is tighter than 600 / 250
    const topLeft = cam.tileToScreen(0, 0);
    const bottomRight = cam.tileToScreen(400, 250);
    expect(topLeft.x).toBeCloseTo(0, 9);
    expect(bottomRight.x).toBeCloseTo(800, 9);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(300, 9);
  });

  it('fitMap can keep the map clear of a bar along the bottom', () => {
    const cam = new Camera(800, 600, 400, 400);
    cam.fitMap(200);
    expect(cam.zoom).toBeCloseTo(1, 9); // 400 px of free height for 400 tiles
    expect(cam.tileToScreen(0, 0).y).toBeCloseTo(0, 9);
    expect(cam.tileToScreen(400, 400).y).toBeCloseTo(400, 9);
  });

  it('pan moves the view with the drag', () => {
    const cam = new Camera(800, 600, 400, 250);
    cam.fitMap();
    const t = cam.screenToTile(400, 300);
    cam.pan(100, -50);
    const moved = cam.tileToScreen(t.x, t.y);
    expect(moved.x).toBeCloseTo(500, 9);
    expect(moved.y).toBeCloseTo(250, 9);
  });

  it('keeps the map from being dragged out of sight', () => {
    const cam = new Camera(800, 600, 400, 250);
    cam.fitMap();
    cam.pan(1e7, 1e7);
    const centre = cam.screenToTile(400, 300);
    expect(centre.x).toBeGreaterThanOrEqual(0);
    expect(centre.y).toBeGreaterThanOrEqual(0);
    cam.pan(-1e7, -1e7);
    const far = cam.screenToTile(400, 300);
    expect(far.x).toBeLessThanOrEqual(400);
    expect(far.y).toBeLessThanOrEqual(250);
  });
});

describe('Camera.centerOn', () => {
  it('puts a map point in the middle of the screen, zooming in to at least the minimum', () => {
    const cam = new Camera(800, 600, 400, 250);
    cam.fitMap();
    cam.centerOn(100, 50, 8);
    expect(cam.zoom).toBe(8);
    expect(cam.tileToScreen(100, 50)).toEqual({ x: 400, y: 300 });
    // never zooms out
    cam.centerOn(200, 100, 2);
    expect(cam.zoom).toBe(8);
    expect(cam.tileToScreen(200, 100)).toEqual({ x: 400, y: 300 });
  });
});
