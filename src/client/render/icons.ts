import type { BuildingType, UnitType } from '../../shared/types';
import { css } from './palette';

type Ctx = CanvasRenderingContext2D;

/**
 * Draws a flat icon for a building of `type`, centred on (x, y) and `size` pixels across, filled with the owner's
 * `color` and outlined in white.
 */
export function drawBuildingIcon(ctx: Ctx, type: BuildingType, x: number, y: number, size: number, color: number, alpha = 1): void {
  const h = size / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, size / 10);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (type) {
    case 'city': // house
      ctx.moveTo(-h, -h * 0.1); ctx.lineTo(0, -h); ctx.lineTo(h, -h * 0.1); ctx.lineTo(h * 0.75, -h * 0.1);
      ctx.lineTo(h * 0.75, h); ctx.lineTo(-h * 0.75, h); ctx.lineTo(-h * 0.75, -h * 0.1); ctx.closePath();
      break;
    case 'factory': // block with a chimney
      ctx.moveTo(-h, h); ctx.lineTo(-h, -h * 0.2); ctx.lineTo(h * 0.2, -h * 0.2); ctx.lineTo(h * 0.2, -h);
      ctx.lineTo(h * 0.65, -h); ctx.lineTo(h * 0.65, -h * 0.2); ctx.lineTo(h, -h * 0.2); ctx.lineTo(h, h); ctx.closePath();
      break;
    case 'barracks': // tent
      ctx.moveTo(-h, h); ctx.lineTo(0, -h); ctx.lineTo(h, h); ctx.closePath();
      break;
    case 'bank': // coin
      ctx.arc(0, 0, h, 0, Math.PI * 2);
      break;
    case 'defensePost': // shield
      ctx.moveTo(-h * 0.8, -h); ctx.lineTo(h * 0.8, -h); ctx.lineTo(h * 0.8, 0);
      ctx.quadraticCurveTo(h * 0.8, h * 0.7, 0, h); ctx.quadraticCurveTo(-h * 0.8, h * 0.7, -h * 0.8, 0); ctx.closePath();
      break;
    case 'fortress': { // battlements
      const s = h / 2.5;
      ctx.moveTo(-h, h); ctx.lineTo(-h, -h);
      for (let i = 0; i < 5; i++) ctx.lineTo(-h + s * (i + 1), i % 2 === 0 ? -h : -h + s);
      ctx.lineTo(h, -h); ctx.lineTo(h, h); ctx.closePath();
      break;
    }
    case 'port': // anchor in a circle
      ctx.arc(0, 0, h, 0, Math.PI * 2);
      break;
    case 'navalBase': // diamond
      ctx.moveTo(0, -h); ctx.lineTo(h, 0); ctx.lineTo(0, h); ctx.lineTo(-h, 0); ctx.closePath();
      break;
    case 'airport': // plane
      ctx.moveTo(0, -h); ctx.lineTo(h * 0.2, -h * 0.2); ctx.lineTo(h, h * 0.1); ctx.lineTo(h * 0.2, h * 0.2);
      ctx.lineTo(h * 0.35, h); ctx.lineTo(0, h * 0.75); ctx.lineTo(-h * 0.35, h); ctx.lineTo(-h * 0.2, h * 0.2);
      ctx.lineTo(-h, h * 0.1); ctx.lineTo(-h * 0.2, -h * 0.2); ctx.closePath();
      break;
    case 'antiAir': // gun on a base
      ctx.moveTo(-h, h); ctx.lineTo(-h * 0.6, h * 0.1); ctx.lineTo(h * 0.6, h * 0.1); ctx.lineTo(h, h); ctx.closePath();
      ctx.moveTo(-h * 0.15, h * 0.1); ctx.lineTo(h * 0.55, -h); ctx.lineTo(h * 0.85, -h * 0.8); ctx.lineTo(h * 0.25, h * 0.1);
      break;
    case 'radar': // dish
      ctx.arc(0, -h * 0.1, h, Math.PI * 0.15, Math.PI * 0.85, true); ctx.closePath();
      ctx.moveTo(-h * 0.15, h * 0.2); ctx.lineTo(h * 0.15, h * 0.2); ctx.lineTo(h * 0.3, h); ctx.lineTo(-h * 0.3, h);
      ctx.closePath();
      break;
  }
  ctx.fill();
  ctx.stroke();
  if (type === 'port') { // the anchor itself, in white
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.6); ctx.lineTo(0, h * 0.6);
    ctx.moveTo(-h * 0.35, -h * 0.3); ctx.lineTo(h * 0.35, -h * 0.3);
    ctx.arc(0, h * 0.1, h * 0.5, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  } else if (type === 'bank') {
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(size * 0.7)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, h * 0.06);
  }
  ctx.restore();
}

/** Draws a flat icon for a unit of `type`, centred on (x, y) and `size` pixels across. */
export function drawUnitIcon(ctx: Ctx, type: UnitType, x: number, y: number, size: number, color: number): void {
  const h = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = css(color);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, size / 10);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (type) {
    case 'troopBoat':
    case 'tradeShip':
    case 'warship': { // hull, longer and pointier for warships
      const len = type === 'warship' ? h * 1.2 : h;
      ctx.moveTo(-len, -h * 0.35); ctx.lineTo(len, -h * 0.35); ctx.lineTo(len * 0.6, h * 0.45);
      ctx.lineTo(-len * 0.6, h * 0.45); ctx.closePath();
      if (type === 'tradeShip') { ctx.moveTo(0, -h * 0.35); ctx.lineTo(0, -h); ctx.lineTo(h * 0.5, -h * 0.5); ctx.closePath(); }
      break;
    }
    default: // planes: a chevron
      ctx.moveTo(0, -h); ctx.lineTo(h, h * 0.6); ctx.lineTo(0, h * 0.15); ctx.lineTo(-h, h * 0.6); ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
