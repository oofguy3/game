import type { NationId } from '../../shared/types';
import type { Camera } from '../camera';
import { formatNumber } from '../format';
import type { ClientState } from '../state';
import type { Effects } from './effects';
import { drawBuildingIcon } from './icons';
import { frontTable } from './look/glMap';
import type { GlMap, GlView } from './look/glMap';
import { TerritoryField } from './look/territoryField';
import { css, TERRAIN_COLORS } from './palette';
import { TerritoryLayer } from './territoryLayer';
import { drawUnits } from './units';
import type { UnitInterpolator } from './units';

/** Labels smaller than this many pixels are hidden. */
const MIN_LABEL_PX = 8;
const MAX_LABEL_PX = 64;
/** How many recent frame times `frameMs` keeps. */
const FRAME_HISTORY = 240;
/** How long the map takes to fade to grey (or back). */
const GREY_MS = 1200;

/**
 * Draws the game every frame. The map comes from the graphics chip (`gl`, on its own canvas underneath) while it
 * works, else from the flat territory picture on this canvas; buildings, units, nation names and effects go on top.
 */
export class Renderer {
  private layer: TerritoryLayer | null = null;
  private offscreen: HTMLCanvasElement | null = null;
  private image: ImageData | null = null;
  private colors = new Map<NationId, number>();
  private names = new Map<NationId, string>();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly frames: number[] = [];
  private greyFrom = 0;
  private greyTo = 0;
  private greyStart = 0;
  /** How grey the map is right now, 0 (full colour) to 1. */
  grey = 0;
  /** The territory for the graphics chip; only kept while there is one. */
  private field: TerritoryField | null = null;
  /** The fronts last sent to the graphics chip, as a key. */
  private frontsKey = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly state: ClientState,
    private readonly camera: Camera,
    private readonly units: UnitInterpolator,
    private readonly effects: Effects,
    private readonly gl: GlMap | null = null,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
  }

  /** Whether the map is being drawn by the graphics chip ('gl') or as the flat picture ('flat'). */
  get look(): 'gl' | 'flat' {
    return this.gl !== null && !this.gl.lost ? 'gl' : 'flat';
  }

  /** How long the last frames took to draw, in ms, oldest first. */
  get frameMs(): readonly number[] {
    return this.frames;
  }

  /** Fades the map to grey (on defeat) or back to colour over GREY_MS. */
  setGrey(on: boolean): void {
    this.greyFrom = this.grey;
    this.greyTo = on ? 1 : 0;
    this.greyStart = performance.now();
  }

  /** Throws the graphics context away, as a lost graphics chip would (for tests). */
  debugLoseContext(): void {
    this.gl?.dispose();
  }

  /** The flat territory picture, one pixel per tile, kept up to date in both looks. */
  territoryImage(): HTMLCanvasElement {
    this.syncTerritory();
    return this.offscreen!;
  }

  /** The map's colour under canvas point (sx, sy), without anything drawn on top of it. */
  sample(sx: number, sy: number): [number, number, number] {
    if (!this.state.init) return [0, 0, 0];
    this.syncTerritory();
    if (this.look === 'gl') return this.gl!.sample(this.view(performance.now()), sx, sy);
    this.drawFlatMap();
    const d = this.ctx.getImageData(Math.floor(sx), Math.floor(sy), 1, 1).data;
    return [d[0], d[1], d[2]];
  }

  draw(): void {
    const { state, ctx, camera } = this;
    if (!state.init) return;
    const start = performance.now();
    this.syncTerritory();
    const fade = Math.min(1, (start - this.greyStart) / GREY_MS);
    this.grey = this.greyFrom + (this.greyTo - this.greyFrom) * fade;
    // the flat look greys through CSS instead of the shader
    this.canvas.classList.toggle('grey', this.greyTo === 1 && this.look === 'flat');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.look === 'gl') {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.gl!.draw(this.view(start));
    } else this.drawFlatMap();
    const { width } = state.init;

    const iconSize = Math.min(28, Math.max(7, camera.zoom * 2.4));
    for (const b of state.buildings) {
      const p = camera.tileToScreen((b.tile % width) + 0.5, Math.floor(b.tile / width) + 0.5);
      if (!this.onScreen(p.x, p.y, iconSize)) continue;
      drawBuildingIcon(ctx, b.type, p.x, p.y, iconSize, this.colors.get(b.owner) ?? 0x808080, b.underConstruction ? 0.5 : 1);
    }
    const now = performance.now();
    drawUnits(ctx, camera, this.units, this.colors, now, iconSize, (x, y) => this.onScreen(x, y, iconSize));
    this.drawLabels();
    this.effects.draw(ctx, camera, now, this.canvas.width, this.canvas.height);
    this.frames.push(performance.now() - start);
    if (this.frames.length > FRAME_HISTORY) this.frames.shift();
  }

  private view(now: number): GlView {
    const { camera } = this;
    return { x: camera.x, y: camera.y, zoom: camera.zoom, time: now / 1000, grey: this.grey };
  }

  /** Today's flat look: water everywhere, then the territory picture scaled up without smoothing. */
  private drawFlatMap(): void {
    const { ctx, camera } = this;
    const { width, height } = this.state.init;
    const z = camera.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css(TERRAIN_COLORS[0]);
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.offscreen!, -camera.x * z, -camera.y * z, width * z, height * z);
  }

  /** Creates the territory image on first use, then repaints the tiles whose owner changed. */
  private syncTerritory(): void {
    const { init } = this.state;
    if (!this.layer) {
      this.colors = new Map(init.nations.map((n) => [n.id, n.color]));
      this.names = new Map(init.nations.map((n) => [n.id, n.name]));
      this.layer = new TerritoryLayer(init.width, init.height, init.terrain, this.colors);
      this.offscreen = document.createElement('canvas');
      this.offscreen.width = init.width;
      this.offscreen.height = init.height;
      this.image = new ImageData(new Uint8ClampedArray(this.layer.pixels.buffer as ArrayBuffer), init.width, init.height);
    }
    const changed = this.state.drainChangedTiles();
    if (this.gl && !this.field) this.field = new TerritoryField(init.width, init.height, init.terrain);
    if (changed.length > 0) {
      this.layer.applyTiles(this.state.owner, changed);
      this.field?.apply(this.state.owner, changed, performance.now() / 1000);
    }
    if (this.gl && this.field && !this.gl.lost) {
      this.gl.syncTerritory(this.field);
      const key = this.state.fronts.map(([a, b]) => `${a}>${b}`).join(',');
      if (key !== this.frontsKey) {
        this.frontsKey = key;
        this.gl.setFronts(frontTable(this.state.fronts));
      }
    }
    const d = this.layer.dirty;
    if (d) {
      this.offscreen!.getContext('2d')!.putImageData(this.image!, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
      this.layer.dirty = null;
    }
  }

  private drawLabels(): void {
    const { ctx, camera, state } = this;
    const spawning = state.phase === 'spawn';
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of state.nations.values()) {
      if (!n.alive || !n.label) continue;
      const p = camera.tileToScreen(n.label.x + 0.5, n.label.y + 0.5);
      if (spawning && n.spawned) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, (6 + 4 * pulse) * Math.max(1, camera.zoom / 2), 0, Math.PI * 2);
        ctx.strokeStyle = css(this.colors.get(n.id) ?? 0xffffff);
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      const px = Math.min(MAX_LABEL_PX, n.label.size * camera.zoom);
      if (px < MIN_LABEL_PX) continue;
      ctx.font = `600 ${Math.round(px)}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, px / 6);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fillStyle = '#ffffff';
      const name = this.names.get(n.id) ?? '';
      ctx.strokeText(name, p.x, p.y);
      ctx.fillText(name, p.x, p.y);
      if (px >= 14) {
        const sub = Math.round(px * 0.6);
        ctx.font = `500 ${sub}px system-ui, sans-serif`;
        ctx.lineWidth = Math.max(2, sub / 6);
        const troops = formatNumber(n.troops);
        ctx.strokeText(troops, p.x, p.y + px * 0.85);
        ctx.fillText(troops, p.x, p.y + px * 0.85);
      }
    }
  }

  private onScreen(x: number, y: number, margin: number): boolean {
    return x > -margin && y > -margin && x < this.canvas.width + margin && y < this.canvas.height + margin;
  }
}
