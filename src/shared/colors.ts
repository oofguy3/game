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

/** The team names, team 1 first. */
export const TEAM_NAMES: readonly string[] = ['Blue', 'Red', 'Green', 'Gold'];
/** Each team's base colour, team 1 first; the player's team is the player's blue. */
export const TEAM_COLORS: readonly number[] = [0x3b82f6, 0xef4444, 0x22c55e, 0xeab308];
/** Each team family's hue range in degrees, team 1 first; a range whose start is above its end wraps past 0. */
const TEAM_HUES: readonly (readonly [number, number])[] = [[195, 240], [340, 20], [95, 155], [35, 55]];
/** Shades per team: enough for the biggest team, 40 bots and the player in 2 teams. Indexes beyond that wrap around. */
const TEAM_PALETTE_SIZE = 21;
const TEAM_HUE_STEP = 5;
const TEAM_LIGHTNESS = [0.36, 0.42, 0.48, 0.54, 0.60, 0.66, 0.70] as const;
const TEAM_SATURATION = [0.55, 0.70, 0.85] as const;

const teamPalettes: (readonly number[] | undefined)[] = [];

/** The player is always blue; bots take a color from a fixed palette in which every color is far from the others. */
export function nationColor(index: number, isPlayer: boolean): number {
  if (isPlayer) return PLAYER_COLOR;
  botPalette ??= buildBotPalette();
  return botPalette[(((index - 1) % BOT_PALETTE_SIZE) + BOT_PALETTE_SIZE) % BOT_PALETTE_SIZE];
}

/**
 * The colour of the nation `index` (from 0, in id order) of team `team` (1–4): a shade of the team's family, far from
 * the other shades of that family. The player keeps the player's blue.
 */
export function teamColor(team: number, index: number, isPlayer: boolean): number {
  if (isPlayer) return PLAYER_COLOR;
  const palette = (teamPalettes[team] ??= buildTeamPalette(team));
  return palette[((index % TEAM_PALETTE_SIZE) + TEAM_PALETTE_SIZE) % TEAM_PALETTE_SIZE];
}

/** The bots' palette: farthest-point picks over the whole hue circle, starting from the player's color. */
function buildBotPalette(): number[] {
  const candidates: number[] = [];
  for (let hue = 0; hue < 360; hue += CANDIDATE_HUE_STEP) {
    for (const lightness of CANDIDATE_LIGHTNESS) {
      for (const saturation of CANDIDATE_SATURATION) candidates.push(hslToRgb(hue, saturation, lightness));
    }
  }
  return farthestPoints(candidates, PLAYER_COLOR, BOT_PALETTE_SIZE);
}

/**
 * A team's palette: its base colour, then farthest-point picks from shades with hues inside the family's range (in
 * `TEAM_HUE_STEP` steps centred in the range).
 */
function buildTeamPalette(team: number): number[] {
  const [from, to] = TEAM_HUES[team - 1];
  const span = (to - from + 360) % 360;
  const candidates: number[] = [];
  for (let offset = TEAM_HUE_STEP / 2; offset < span; offset += TEAM_HUE_STEP) {
    const hue = (from + offset) % 360;
    for (const lightness of TEAM_LIGHTNESS) {
      for (const saturation of TEAM_SATURATION) candidates.push(hslToRgb(hue, saturation, lightness));
    }
  }
  const base = TEAM_COLORS[team - 1];
  return [base, ...farthestPoints(candidates, base, TEAM_PALETTE_SIZE - 1)];
}

/**
 * Greedy farthest-point selection in RGB space. Starting from `start` (not itself picked), repeatedly picks the
 * candidate whose nearest already-chosen color is farthest away (the lowest candidate index wins ties), so the colors
 * are as distinguishable on the map as a fixed-size palette allows. Deterministic: depends on nothing but the inputs.
 */
function farthestPoints(candidates: readonly number[], start: number, count: number): number[] {
  // Squared distance from each candidate to the nearest chosen color; squares order the same as distances.
  const nearest = candidates.map((c) => squaredDistance(c, start));
  const palette: number[] = [];
  while (palette.length < count) {
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
