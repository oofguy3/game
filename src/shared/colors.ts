/** The human player's color, 0xRRGGBB. */
export const PLAYER_COLOR = 0x3b82f6;
/** Neutral grey used for the "unowned" placeholder nation. */
export const UNOWNED_COLOR = 0x6b7280;

const PLAYER_HUE = 217;
/** Bot hues closer than this to the player's blue are shifted away from it. */
const PLAYER_HUE_BAND = 12;
const PLAYER_HUE_SHIFT = 30;
const GOLDEN_ANGLE = 137.508;
const BOT_SATURATION = 0.65;
const BOT_LIGHTNESS = 0.52;

/** The player is always blue; bots walk the colour wheel by the golden angle at a fixed saturation and lightness. */
export function nationColor(index: number, isPlayer: boolean): number {
  if (isPlayer) return PLAYER_COLOR;
  let hue = (((index * GOLDEN_ANGLE) % 360) + 360) % 360;
  const fromPlayer = Math.abs(((hue - PLAYER_HUE + 540) % 360) - 180);
  if (fromPlayer <= PLAYER_HUE_BAND) hue = (hue + PLAYER_HUE_SHIFT) % 360;
  return hslToRgb(hue, BOT_SATURATION, BOT_LIGHTNESS);
}

/** Hue in degrees [0, 360), saturation and lightness in [0, 1]; returns 0xRRGGBB. */
function hslToRgb(hue: number, saturation: number, lightness: number): number {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (sector < 1) { r = chroma; g = second; }
  else if (sector < 2) { r = second; g = chroma; }
  else if (sector < 3) { g = chroma; b = second; }
  else if (sector < 4) { g = second; b = chroma; }
  else if (sector < 5) { r = second; b = chroma; }
  else { r = chroma; b = second; }
  const offset = lightness - chroma / 2;
  const channel = (v: number): number => Math.round((v + offset) * 255);
  return (channel(r) << 16) | (channel(g) << 8) | channel(b);
}
