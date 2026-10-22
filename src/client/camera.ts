const MIN_ZOOM = 0.5;
const MAX_ZOOM = 32;

/**
 * What part of the map the screen shows. `x`, `y` are the map position (in tiles) at the screen's top-left corner;
 * `zoom` is screen pixels per tile.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  constructor(private viewW: number, private viewH: number, private readonly mapW: number, private readonly mapH: number) {}

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }

  tileToScreen(tx: number, ty: number): { x: number; y: number } {
    return { x: (tx - this.x) * this.zoom, y: (ty - this.y) * this.zoom };
  }

  /** Zooms by `factor` (kept within [0.5, 32]) around the screen point (sx, sy), which stays over the same map spot. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToTile(sx, sy);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.x = before.x - sx / this.zoom;
    this.y = before.y - sy / this.zoom;
    this.clamp();
  }

  /** Moves the view with a drag of (dx, dy) screen pixels. */
  pan(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  /** Zooms to show the whole map, centred. */
  fitMap(): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(this.viewW / this.mapW, this.viewH / this.mapH)));
    this.x = (this.mapW - this.viewW / this.zoom) / 2;
    this.y = (this.mapH - this.viewH / this.zoom) / 2;
  }

  /** Keeps the screen's centre over the map, so it can't be dragged out of sight. */
  private clamp(): void {
    const halfW = this.viewW / (2 * this.zoom);
    const halfH = this.viewH / (2 * this.zoom);
    this.x = Math.min(this.mapW - halfW, Math.max(-halfW, this.x));
    this.y = Math.min(this.mapH - halfH, Math.max(-halfH, this.y));
  }
}
