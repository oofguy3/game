import type { Rng } from '../util/rng';

const SYLLABLES: readonly string[] = [
  'ka', 'lo', 'mir', 'dan', 'vel', 'tor', 'sa', 'ren', 'ith', 'ur', 'ba', 'zan', 'el', 'po', 'gra', 'nu',
  'shi', 'ov', 'tra', 'mek', 'ia', 'dor', 'fen', 'qua', 'ly', 'har', 'ni', 'bel', 'cor', 'yu', 'wen', 'ast',
];
const MIN_SYLLABLES = 2;
const MAX_SYLLABLES = 3;
/** After this many clashes in a row the names get one syllable longer, so a huge count still terminates. */
const ATTEMPTS_PER_EXTRA_SYLLABLE = 25;

/** `count` unique invented nation names built from syllables; the same Rng state gives the same names. */
export function nationNames(rng: Rng, count: number): string[] {
  const names: string[] = [];
  const used = new Set<string>();
  while (names.length < count) {
    let name: string;
    let attempt = 0;
    do {
      const length = rng.int(MIN_SYLLABLES, MAX_SYLLABLES) + Math.floor(attempt / ATTEMPTS_PER_EXTRA_SYLLABLE);
      let word = '';
      for (let i = 0; i < length; i++) word += rng.pick(SYLLABLES);
      name = word[0].toUpperCase() + word.slice(1);
      attempt++;
    } while (used.has(name));
    used.add(name);
    names.push(name);
  }
  return names;
}
