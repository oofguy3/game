import type { GameEvent } from '../../shared/types';
import type { Camera } from '../camera';
import type { ClientState } from '../state';
import type { KeyValue } from '../storage';
import { h } from './dom';
import { flashesFor, mergeFlashes, minimapSize, minimapToTile, viewBox } from './minimapGeometry';
import type { Flash, MiniSize } from './minimapGeometry';

export const MINIMAP_KEY = 'borderline.minimap';
const FLASH_MS = 1500;
const MAX_FLASHES = 12;

/**
 * The minimap in the bottom-right corner: the whole map with every nation's land, a box for the part the camera
 * shows, and danger flashes. Click or drag on it to move the camera there; M shows or hides it (remembered).
 */
export class Minimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly size: MiniSize;
  private readonly ratio = window.devicePixelRatio || 1;
  private flashes: Flash[] = [];
  private dragging = false;

  constructor(
    private readonly state: ClientState,
    private readonly camera: Camera,
    private readonly image: () => HTMLCanvasElement,
    private readonly storage: KeyValue,
  ) {
    this.size = minimapSize(state.init.width, state.init.height);
    this.canvas = h('canvas', { attrs: { 'aria-label': 'Minimap' } });
    this.canvas.width = Math.round(this.size.w * this.ratio);
    this.canvas.height = Math.round(this.size.h * this.ratio);
    this.canvas.style.width = `${this.size.w}px`;
    this.canvas.style.height = `${this.size.h}px`;
    this.ctx = this.canvas.getContext('2d');
    this.el = h('div', { class: 'panel minimap' }, this.canvas);
    if (storage.getItem(MINIMAP_KEY) === 'hidden') this.el.classList.add('hidden');
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.jump(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.jump(e);
    });
    const stop = (): void => {
      this.dragging = false;
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  /** How many flashes are showing. */
  get flashCount(): number {
    return this.flashes.length;
  }

  toggle(): void {
    const hidden = this.el.classList.toggle('hidden');
    this.storage.setItem(MINIMAP_KEY, hidden ? 'hidden' : 'shown');
  }

  /** Takes the update's lost land and bombs as flashes (one ring at a time per cell and kind). */
  onUpdate(events: GameEvent[], now: number): void {
    const { init, lost } = this.state;
    this.flashes = mergeFlashes(this.flashes, flashesFor(events, lost, init.playerId, init.width, now), now, FLASH_MS, MAX_FLASHES);
  }

  /** Draws the map picture, the view box for a `viewW`×`viewH` screen, and the flashes still fading. */
  draw(now: number, viewW: number, viewH: number): void {
    this.flashes = this.flashes.filter((f) => now - f.start < FLASH_MS);
    const { ctx, size } = this;
    if (!ctx || !this.visible) return;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.image(), 0, 0, size.w, size.h);
    const box = viewBox(this.camera, viewW, viewH, size);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    for (const f of this.flashes) {
      const t = (now - f.start) / FLASH_MS;
      ctx.beginPath();
      ctx.arc(f.x * size.scale, f.y * size.scale, 4 + 6 * t, 0, Math.PI * 2);
      ctx.strokeStyle = f.kind === 'danger' ? `rgba(239, 68, 68, ${1 - t})` : `rgba(251, 146, 60, ${1 - t})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  private jump(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const t = minimapToTile(e.clientX - r.left, e.clientY - r.top, this.size);
    this.camera.centerOn(t.x, t.y);
  }
}
