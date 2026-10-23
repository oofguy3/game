import type { BuildingType } from '../../shared/types';
import { drawBuildingIcon } from '../render/icons';
import { h } from './dom';

/** A small canvas with the map icon of a building of `type` in `color`, drawn sharp on high-density screens. */
export function createBuildIcon(type: BuildingType, color: number, cssSize = 22): HTMLCanvasElement {
  const canvas = h('canvas', { class: 'build-icon', attrs: { 'aria-hidden': 'true' } });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssSize * ratio);
  canvas.height = Math.round(cssSize * ratio);
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(ratio, ratio);
    drawBuildingIcon(ctx, type, cssSize / 2, cssSize / 2, cssSize * 0.78, color);
  }
  return canvas;
}
