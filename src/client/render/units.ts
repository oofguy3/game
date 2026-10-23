import type { NationId } from '../../shared/types';
import type { UnitSnap } from '../../worker/protocol';
import type { Camera } from '../camera';
import { drawUnitIcon } from './icons';

/** Assumed time between updates until two have arrived. */
const DEFAULT_INTERVAL_MS = 100;
const MIN_INTERVAL_MS = 16;
const MAX_INTERVAL_MS = 500;

/**
 * Smooths unit movement between updates: each unit glides from where the previous update had it to where the latest
 * has it, over the time the last two updates were apart.
 */
export class UnitInterpolator {
  private prev = new Map<number, { x: number; y: number }>();
  private units: UnitSnap[] = [];
  private at = -Infinity;
  private interval = DEFAULT_INTERVAL_MS;

  update(units: UnitSnap[], now: number): void {
    if (Number.isFinite(this.at)) this.interval = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, now - this.at));
    this.prev = new Map(this.units.map((u) => [u.id, { x: u.x, y: u.y }]));
    this.units = units;
    this.at = now;
  }

  /** Where every unit is drawn at time `now`. */
  positions(now: number): { unit: UnitSnap; x: number; y: number }[] {
    const a = Math.min(1, Math.max(0, (now - this.at) / this.interval));
    return this.units.map((unit) => {
      const p = this.prev.get(unit.id);
      return p ? { unit, x: p.x + (unit.x - p.x) * a, y: p.y + (unit.y - p.y) * a } : { unit, x: unit.x, y: unit.y };
    });
  }
}

/** Draws every unit at its smoothed position, `size` pixels across, skipping those off screen. */
export function drawUnits(
  ctx: CanvasRenderingContext2D, camera: Camera, units: UnitInterpolator, colors: Map<NationId, number>, now: number,
  size: number, visible: (x: number, y: number) => boolean,
): void {
  for (const { unit, x, y } of units.positions(now)) {
    const p = camera.tileToScreen(x + 0.5, y + 0.5);
    if (!visible(p.x, p.y)) continue;
    drawUnitIcon(ctx, unit.type, p.x, p.y, size, colors.get(unit.owner) ?? 0x808080);
  }
}
