/** The human player's color, 0xRRGGBB. */
export const PLAYER_COLOR = 0x3b82f6;
/** Neutral grey used for the "unowned" placeholder nation. */
export const UNOWNED_COLOR = 0x6b7280;

/** Bots: 4-40, so 40 colors are enough; ids beyond that wrap around. */
const BOT_PALETTE_SIZE = 40;
const CANDIDATE_HUE_STEP = 6;
const CANDIDATE_LIGHTNESS = [0.34, 0.46, 0.58, 0.70] as const;
const CANDIDATE_SATURATION = [0.55, 0.80] as const;

let botPalette: readonly number[] | undefined;

/** The player is always blue; bots take a color from a fixed palette in which every color is far from the others. */
export function nationColor(index: number, isPlayer: boolean): number {
  if (isPlayer) return PLAYER_COLOR;
  botPalette ??= buildBotPalette();
  return botPalette[(((index - 1) % BOT_PALETTE_SIZE) + BOT_PALETTE_SIZE) % BOT_PALETTE_SIZE];
}

/**
 * Greedy farthest-point selection in RGB space. Starting from the player's color, repeatedly picks the candidate
 * whose nearest already-chosen color is farthest away (the lowest candidate index wins ties), so the colors are
 * as distinguishable on the map as a fixed-size palette allows. Deterministic: depends on nothing but the constants.
 */
function buildBotPalette(): number[] {
  const candidates: number[] = [];
  for (let hue = 0; hue < 360; hue += CANDIDATE_HUE_STEP) {
    for (const lightness of CANDIDATE_LIGHTNESS) {
      for (const saturation of CANDIDATE_SATURATION) candidates.push(hslToRgb(hue, saturation, lightness));
    }
  }

  // Squared distance from each candidate to the nearest chosen color; squares order the same as distances.
  const nearest = candidates.map((c) => squaredDistance(c, PLAYER_COLOR));
  const palette: number[] = [];
  while (palette.length < BOT_PALETTE_SIZE) {
    let best = 0;
    for (let i = 1; i < candidates.length; i++) {
      if (nearest[i] > nearest[best]) best = i;
    }
    const picked = candidates[best];
    palette.push(picked);
    for (let i = 0; i < candidates.length; i++) {
      nearest[i] = Math.min(nearest[i], squaredDistance(candidates[i], picked));
    }
  }
  return palette;
}

function squaredDistance(a: number, b: number): number {
  const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
  const db = (a & 255) - (b & 255);
  return dr * dr + dg * dg + db * db;
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
