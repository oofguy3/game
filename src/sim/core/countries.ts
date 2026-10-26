import type { Rng } from '../util/rng';

/** Real countries the world-map nations are named after. The same length as a full RoWorld roster. */
export const COUNTRIES: readonly string[] = [
  'France', 'Germany', 'Spain', 'Italy', 'Poland', 'Ukraine', 'Romania', 'Netherlands', 'Belgium', 'Sweden',
  'Norway', 'Finland', 'Denmark', 'Portugal', 'Greece', 'Czechia', 'Austria', 'Hungary', 'Ireland', 'Switzerland',
  'United Kingdom', 'Iceland', 'Serbia', 'Croatia', 'Bulgaria', 'Slovakia', 'Lithuania', 'Latvia', 'Estonia',
  'Belarus', 'Moldova', 'Slovenia', 'Albania', 'Montenegro', 'Luxembourg', 'Turkey', 'Russia', 'China', 'India',
  'Japan', 'South Korea', 'Indonesia', 'Vietnam', 'Thailand', 'Philippines', 'Malaysia', 'Pakistan', 'Bangladesh',
  'Iran', 'Iraq', 'Saudi Arabia', 'Israel', 'Egypt', 'Nigeria', 'South Africa', 'Kenya', 'Ethiopia', 'Morocco',
  'Algeria', 'Ghana', 'Tanzania', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Colombia', 'Chile', 'Peru',
  'United States', 'Australia', 'New Zealand', 'Cuba', 'Kazakhstan', 'Mongolia', 'Nepal', 'Sri Lanka', 'Myanmar',
  'Cambodia', 'Taiwan', 'Madagascar', 'Angola', 'Sudan', 'Libya', 'Tunisia', 'Qatar', 'Oman', 'Jordan', 'Niger',
];

/**
 * `count` distinct country names, shuffled by `rng`. `avoid` (the player's own name) is skipped when another country
 * is left. Past the list, names repeat with a roman suffix so a huge bot count still terminates.
 */
export function countryNames(rng: Rng, count: number, avoid = ''): string[] {
  const pool = COUNTRIES.filter((name) => name !== avoid);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const swap = pool[i];
    pool[i] = pool[j];
    pool[j] = swap;
  }
  const names: string[] = [];
  for (let round = 1; names.length < count && round < 6; round++) {
    for (const base of pool) {
      if (names.length >= count) break;
      names.push(round === 1 ? base : `${base} ${round}`);
    }
  }
  return names;
}
