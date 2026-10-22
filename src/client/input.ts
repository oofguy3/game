import { BUILDING_TYPES } from '../shared/types';
import type { BuildingType, Command } from '../shared/types';
import type { Camera } from './camera';
import type { ClientState } from './state';
import { BUILD_HOTKEYS } from './ui/hud';

export type Mode =
  | { kind: 'default' }
  | { kind: 'build'; building: BuildingType }
  | { kind: 'target'; action: 'bomb' | 'paradrop' | 'boat' };

export interface ControlActions {
  send(cmd: Command): void;
  attackRatio(): number;
  nudgeRatio(step: number): void;
  togglePause(): void;
  /** Whether the player can place a building of `type` right now. */
  canBuild(type: BuildingType): boolean;
  onModeChange(mode: Mode): void;
}

/** A drag shorter than this many pixels is a click. */
const DRAG_THRESHOLD = 5;
const ZOOM_STEP = 1.15;
/** Keyboard panning speed in screen pixels per second. */
const KEY_PAN_SPEED = 700;
const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [1, 0], arrowleft: [1, 0], d: [-1, 0], arrowright: [-1, 0],
};

/** Mouse and keyboard: clicks become commands, drags and keys move the camera. */
export class Controls {
  mode: Mode = { kind: 'default' };
  private down: { x: number; y: number; lastX: number; lastY: number; dragging: boolean } | null = null;
  private readonly held = new Set<string>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly state: ClientState,
    private readonly actions: ControlActions,
  ) {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.down = { x: e.offsetX, y: e.offsetY, lastX: e.offsetX, lastY: e.offsetY, dragging: false };
    });
    window.addEventListener('mousemove', (e) => {
      const d = this.down;
      if (!d) return;
      const { x, y } = this.local(e);
      if (!d.dragging && Math.hypot(x - d.x, y - d.y) > DRAG_THRESHOLD) d.dragging = true;
      if (d.dragging) this.camera.pan(x - d.lastX, y - d.lastY);
      d.lastX = x;
      d.lastY = y;
    });
    window.addEventListener('mouseup', (e) => {
      const d = this.down;
      this.down = null;
      if (d && !d.dragging && e.button === 0) this.click(d.x, d.y);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.held.clear());
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.canvas.classList.toggle('placing', mode.kind !== 'default');
    this.actions.onModeChange(mode);
  }

  /** Pans for held keys; call once per frame with the seconds since the last frame. */
  frame(dt: number): void {
    let dx = 0;
    let dy = 0;
    for (const key of this.held) {
      const dir = PAN_KEYS[key];
      if (dir) {
        dx += dir[0];
        dy += dir[1];
      }
    }
    if (dx !== 0 || dy !== 0) this.camera.pan(dx * KEY_PAN_SPEED * dt, dy * KEY_PAN_SPEED * dt);
  }

  private click(sx: number, sy: number): void {
    const { init } = this.state;
    const t = this.camera.screenToTile(sx, sy);
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    if (x < 0 || y < 0 || x >= init.width || y >= init.height) return;
    const tile = y * init.width + x;
    const nation = init.playerId;
    const ratio = this.actions.attackRatio();
    const mode = this.mode;
    if (this.state.phase === 'spawn') {
      this.actions.send({ type: 'spawn', nation, tile });
      return;
    }
    if (mode.kind === 'build') this.actions.send({ type: 'build', nation, building: mode.building, tile });
    else if (mode.kind === 'target') {
      if (mode.action === 'bomb') this.actions.send({ type: 'bomb', nation, tile });
      else if (mode.action === 'paradrop') this.actions.send({ type: 'paradrop', nation, tile, ratio });
      else this.actions.send({ type: 'boat', nation, tile, ratio });
    } else this.actions.send({ type: 'attack', nation, tile, ratio, allowBoat: true });
    if (mode.kind !== 'default') this.setMode({ kind: 'default' });
  }

  private keyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const key = e.key.toLowerCase();
    if (key in PAN_KEYS) {
      this.held.add(key);
      e.preventDefault();
      return;
    }
    if (key === ' ') {
      e.preventDefault();
      this.actions.togglePause();
    } else if (key === 'escape') this.setMode({ kind: 'default' });
    else if (key === '[') this.actions.nudgeRatio(-10);
    else if (key === ']') this.actions.nudgeRatio(10);
    else {
      const i = BUILD_HOTKEYS.indexOf(key);
      if (i >= 0 && this.actions.canBuild(BUILDING_TYPES[i])) this.setMode({ kind: 'build', building: BUILDING_TYPES[i] });
    }
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
}
