import { describe, expect, it } from 'vitest';
import { PLAYER_COLOR, TEAM_COLORS, TEAM_NAMES, teamColor } from './colors';

/** The hue of 0xRRGGBB in degrees [0, 360). */
function hueOf(rgb: number): number {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Each family's hue range in degrees, from → to going up (Red wraps past 0). */
const HUES: [number, number][] = [[195, 240], [340, 20], [95, 155], [35, 55]];
const inRange = (hue: number, [from, to]: [number, number]): boolean =>
  from <= to ? hue >= from && hue <= to : hue >= from || hue <= to;

/** The most nations one team can have: 40 bots and the player in 2 teams. */
const BIGGEST_TEAM = 21;

describe('team colours', () => {
  it('names the teams and their base colours', () => {
    expect(TEAM_NAMES).toEqual(['Blue', 'Red', 'Green', 'Gold']);
    expect(TEAM_COLORS).toEqual([0x3b82f6, 0xef4444, 0x22c55e, 0xeab308]);
    expect(TEAM_COLORS[0]).toBe(PLAYER_COLOR);
  });

  it(`teamColor keeps each family in its hue range and gives ${BIGGEST_TEAM} different shades`, () => {
    HUES.forEach((range, i) => {
      const team = i + 1;
      const shades = Array.from({ length: BIGGEST_TEAM }, (_, index) => teamColor(team, index, false));
      for (const c of shades) expect(inRange(hueOf(c), range), `${TEAM_NAMES[i]} ${c.toString(16)}`).toBe(true);
      expect(new Set(shades).size).toBe(BIGGEST_TEAM);
      // the first shade is the family's base colour, and an index past the palette wraps into it
      expect(shades[0]).toBe(TEAM_COLORS[i]);
      expect(inRange(hueOf(teamColor(team, 1000, false)), range)).toBe(true);
    });
  });

  it('the player keeps the player colour', () => {
    expect(teamColor(1, 0, true)).toBe(PLAYER_COLOR);
  });
});
