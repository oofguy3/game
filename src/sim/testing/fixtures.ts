import { DEFAULT_RULES } from '../../shared/rules';
import type { MatchRules } from '../../shared/rules';
import type { Difficulty } from '../../shared/types';
import { Game } from '../core/game';
import type { Nation } from '../core/nation';
import { lockTeams } from '../core/teams';
import { mapFromAscii } from './asciiMap';

export interface TestGameOptions {
  /** Rows of `.` water, `#` plains, `^` hills and `M` mountains. */
  map: string[];
  /** Same shape as `map`: `a`-`z` is nation 1-26, `.` is unowned. */
  owners?: string[];
  /** One entry per bot; `nations[i]` overrides fields on nation i+1 after ownership is applied. */
  nations: Partial<Nation>[];
  seed?: number;
  debug?: boolean;
  /** Turns the win-condition check on; off by default so small scenarios don't end the game. */
  victory?: boolean;
  /** Per-bot difficulty, `'normal'` where not given. */
  difficulties?: Difficulty[];
  /** Rules to change from `DEFAULT_RULES`. */
  rules?: Partial<MatchRules>;
  /**
   * The team of nation i+1, for a teams game: the rules' mode becomes 'teams' (with as many teams as the highest one
   * given, at least 2), unless `rules` says otherwise.
   */
  teams?: number[];
}

const FIRST_OWNER_LETTER = 'a'.charCodeAt(0);
const LAST_OWNER_LETTER = 'z'.charCodeAt(0);

/**
 * A bot-only game in the `'playing'` phase, built from ASCII grids, with its event and changed-tile queues empty. With
 * `teams`, the teams are locked once more after the overrides, so a `team` override is allied too.
 */
export function makeTestGame(opts: TestGameOptions): Game {
  const map = mapFromAscii(opts.map);
  const teamRules: Partial<MatchRules> = opts.teams
    ? { mode: 'teams', teams: Math.min(4, Math.max(2, ...opts.teams)) as MatchRules['teams'] }
    : {};
  const game = new Game({
    map,
    seed: opts.seed ?? 1,
    player: null,
    bots: opts.nations.map((_, i) => ({ difficulty: opts.difficulties?.[i] ?? 'normal', team: opts.teams?.[i] })),
    debug: opts.debug,
    checkVictory: opts.victory ?? false,
    rules: { ...DEFAULT_RULES, ...teamRules, ...opts.rules },
  });
  if (opts.owners) applyOwners(game, opts.owners);
  opts.nations.forEach((overrides, i) => Object.assign(game.nations[i + 1], overrides));
  if (opts.teams) lockTeams(game);
  game.phase = 'playing';
  game.drainChangedTiles();
  game.drainEvents();
  return game;
}

function applyOwners(game: Game, rows: string[]): void {
  const { width, height } = game.map;
  if (rows.length !== height) throw new Error(`owners has ${rows.length} rows but the map has ${height}`);
  for (let y = 0; y < height; y++) {
    if (rows[y].length !== width) {
      throw new Error(`owners row ${y} has ${rows[y].length} characters but the map is ${width} wide`);
    }
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const code = ch.charCodeAt(0);
      if (ch.length !== 1 || code < FIRST_OWNER_LETTER || code > LAST_OWNER_LETTER) {
        throw new Error(`Unknown owners character '${ch}' at row ${y}, column ${x}`);
      }
      const id = code - FIRST_OWNER_LETTER + 1;
      if (id >= game.nations.length) {
        throw new Error(`owners uses '${ch}' (nation ${id}) but only ${game.nations.length - 1} nations were given`);
      }
      game.setOwner(y * width + x, id);
    }
  }
  for (const nation of game.nations) {
    if (nation.tiles > 0) nation.spawned = true;
  }
}
