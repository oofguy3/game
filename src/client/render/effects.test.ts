import { describe, expect, it } from 'vitest';
import { edgeArrow } from './effects';

describe('edgeArrow', () => {
  it('is null for a point on screen', () => {
    expect(edgeArrow(800, 600, 400, 300, 20)).toBeNull();
  });

  it('sits on the screen edge, inset, pointing at the point', () => {
    const right = edgeArrow(800, 600, 2000, 300, 20)!;
    expect(right.x).toBeCloseTo(780);
    expect(right.y).toBeCloseTo(300);
    expect(right.angle).toBeCloseTo(0);
    const above = edgeArrow(800, 600, 400, -500, 20)!;
    expect(above.x).toBeCloseTo(400);
    expect(above.y).toBeCloseTo(20);
    expect(above.angle).toBeCloseTo(-Math.PI / 2);
    const corner = edgeArrow(800, 600, -1000, 1300, 20)!;
    expect(corner.x).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(corner.y).toBeLessThanOrEqual(580 + 1e-9);
    expect(Math.abs(corner.x - 20) < 1e-9 || Math.abs(corner.y - 580) < 1e-9).toBe(true);
  });
});
