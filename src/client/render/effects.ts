import type { GameEvent, NationId, UnitType } from '../../shared/types';
import type { Camera } from '../camera';
import type { ClientState } from '../state';

const FLASH_MS = 700;
/** A radar warning follows its plane this long at most, and drops it once unseen this long. */
const WARNING_MS = 20_000;
const LOST_MS = 1_000;
/** How far (tiles) a warned plane may have moved between frames and still be the same one. */
const TRACK_TILES = 12;
const ARROW_INSET = 26;

/**
 * Where an arrow pointing at screen point (px, py) goes when the point is off a `w`×`h` screen: on the screen's edge
 * (inset by `inset`), on the line from the centre to the point, with the angle it points at. Null when on screen.
 */
export function edgeArrow(w: number, h: number, px: number, py: number, inset: number): { x: number; y: number; angle: number } | null {
  if (px >= 0 && py >= 0 && px <= w && py <= h) return null;
  const cx = w / 2;
  const cy = h / 2;
  const dx = px - cx;
  const dy = py - cy;
  const sx = dx === 0 ? Infinity : (cx - inset) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (cy - inset) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s, angle: Math.atan2(dy, dx) };
}

interface Warning {
  from: NationId;
  unit: UnitType;
  x: number;
  y: number;
  start: number;
  seen: number;
}

/** Short-lived marks on the map: flashes where bombs fall, and red markers or edge arrows for planes radar warned of. */
export class Effects {
  private flashes: { x: number; y: number; start: number }[] = [];
  private warnings: Warning[] = [];

  constructor(private readonly state: ClientState) {}

  onEvents(events: GameEvent[], now: number): void {
    const { width } = this.state.init;
    for (const e of events) {
      if (e.type === 'bombed' || e.type === 'nuked') this.flashes.push({ x: e.tile % width, y: Math.floor(e.tile / width), start: now });
      else if (e.type === 'radarWarning' && e.nation === this.state.init.playerId) {
        this.warnings.push({ from: e.from, unit: e.unit, x: e.tile % width, y: Math.floor(e.tile / width), start: now, seen: now });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, now: number, w: number, h: number): void {
    this.flashes = this.flashes.filter((f) => now - f.start < FLASH_MS);
    for (const f of this.flashes) {
      const t = (now - f.start) / FLASH_MS;
      const p = camera.tileToScreen(f.x + 0.5, f.y + 0.5);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(6, 5 * camera.zoom) * (0.4 + t), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(251, 146, 60, ${0.7 * (1 - t)})`;
      ctx.fill();
    }
    this.trackWarnings(now);
    for (const wn of this.warnings) {
      const p = camera.tileToScreen(wn.x + 0.5, wn.y + 0.5);
      const arrow = edgeArrow(w, h, p.x, p.y, ARROW_INSET);
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.fillStyle = '#ef4444';
      ctx.lineWidth = 3;
      if (arrow === null) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12 + 4 * Math.sin(now / 120), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.translate(arrow.x, arrow.y);
        ctx.rotate(arrow.angle);
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(-10, -11);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-10, 11);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Moves each warning onto its plane (the nearest of that owner and type), and drops those gone or too old. */
  private trackWarnings(now: number): void {
    this.warnings = this.warnings.filter((wn) => {
      let best: { x: number; y: number; d: number } | null = null;
      for (const u of this.state.units) {
        if (u.owner !== wn.from || u.type !== wn.unit) continue;
        const d = Math.hypot(u.x - wn.x, u.y - wn.y);
        if (d <= TRACK_TILES && (best === null || d < best.d)) best = { x: u.x, y: u.y, d };
      }
      if (best) {
        wn.x = best.x;
        wn.y = best.y;
        wn.seen = now;
      }
      return now - wn.start < WARNING_MS && now - wn.seen < LOST_MS;
    });
  }
}
