import { nationColor } from '../../shared/colors';
import { decodeWorldMap } from '../../sim/map/worldMap';
import { lookOptions } from '../../sim/snapshot';
import { GlMap } from '../render/look/glMap';
import { buildTerrainLook } from '../render/look/terrainLook';
import { NEVER, TerritoryField } from '../render/look/territoryField';
import { h } from './dom';
import { growNations } from './fakeNations';

const NATIONS = 16;
const SHARE = 0.35;
/** Tiles per second the view drifts at its fastest. */
const DRIFT = 3;
const ZOOM = 2.2;
const ZOOM_SWING = 0.3;

/**
 * The world map in the new look, with made-up nations, drifting slowly behind the title screen. Without WebGL2 (or if
 * the map can't load) `host` gets the `backdrop-fallback` class instead. Returns a function that stops it.
 */
export function startBackdrop(host: HTMLElement): () => void {
  const canvas = h('canvas', { class: 'backdrop' });
  host.prepend(canvas);
  let stopped = false;
  let frame = 0;
  let gl: GlMap | null = null;
  const size = (): void => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  size();
  window.addEventListener('resize', size);
  const fallback = (): void => {
    if (!stopped) host.classList.add('backdrop-fallback');
  };

  void (async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}maps/world.bin`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const map = decodeWorldMap(new Uint8Array(await res.arrayBuffer()));
      if (stopped) return;
      const { width, height, terrain } = map;
      const colors = new Map(Array.from({ length: NATIONS }, (_, i) => [i + 1, nationColor(i + 1, false)] as [number, number]));
      gl = GlMap.create(canvas, buildTerrainLook(width, height, terrain, lookOptions({ kind: 'world' })), colors);
      if (!gl) {
        fallback();
        return;
      }
      const owners = growNations(width, height, terrain, NATIONS, SHARE, 1);
      const field = new TerritoryField(width, height, terrain);
      const tiles: number[] = [];
      for (let t = 0; t < owners.length; t++) if (owners[t] !== 0) tiles.push(t);
      field.apply(owners, tiles, NEVER);
      gl.syncTerritory(field);
      const start = performance.now();
      const swing = 0.3 * width;
      const loop = (now: number): void => {
        if (stopped || !gl || gl.lost) return;
        const t = (now - start) / 1000;
        const zoom = ZOOM + ZOOM_SWING * Math.sin(t / 9);
        const cx = width * 0.5 + swing * Math.sin((t * DRIFT) / swing);
        const cy = height * (0.45 + 0.08 * Math.sin(t / 47));
        gl.draw({ x: cx - canvas.width / (2 * zoom), y: cy - canvas.height / (2 * zoom), zoom, time: now / 1000, grey: 0 });
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    } catch {
      fallback();
    }
  })();

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', size);
    gl?.dispose();
    canvas.remove();
    host.classList.remove('backdrop-fallback');
  };
}
