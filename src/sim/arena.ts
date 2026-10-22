import type { Difficulty, MapSize, NationId } from '../shared/types';
import { generateRandomMap } from './map/randomMap';
import { Match } from './match';
import { maxTroops } from './systems/economy';

export interface ArenaSpec {
  seed: number;
  size: MapSize;
  teams: { difficulty: Difficulty; count: number }[];
  maxTicks: number;
}

export interface ArenaResult {
  /** The winning nation's difficulty (or, with no result by `maxTicks`, the largest nation's); null if no one holds land. */
  winner: Difficulty | null;
  /** Every bot, most land first (ties: lower id first). */
  ranking: { id: NationId; difficulty: Difficulty; tiles: number }[];
  ticks: number;
  /** Per difficulty: the share of its bots' living playing ticks spent above `MAX_RATIO` of their troop cap. */
  timeAtMaxShare: Record<Difficulty, number>;
}

export interface HeadToHead {
  aWins: number;
  bWins: number;
  draws: number;
  /** aWins over the number of matches. */
  rateA: number;
  /** Per difficulty taking part: the mean of its timeAtMaxShare over the matches. */
  timeAtMaxShare: Partial<Record<Difficulty, number>>;
}

/** A troop ratio above this counts as sitting at the cap (wasting growth). */
const MAX_RATIO = 0.95;
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'insane'];

/**
 * Plays one bots-only match on a random map of `spec.size` from `spec.seed`: no player, a one-tick spawn phase, until
 * someone wins or `spec.maxTicks` pass. Teams are interleaved by id (a, b, a, b, …) so no team always picks its spawns
 * first.
 */
export function runMatch(spec: ArenaSpec): ArenaResult {
  const bots = interleave(spec.teams).map((difficulty) => ({ difficulty }));
  const m = new Match({ map: generateRandomMap(spec.seed, spec.size), seed: spec.seed, player: null, bots, spawnTicks: 1 });
  const { game } = m;
  const atMax: Record<Difficulty, number> = { easy: 0, normal: 0, hard: 0, insane: 0 };
  const living: Record<Difficulty, number> = { easy: 0, normal: 0, hard: 0, insane: 0 };

  while (game.result === null && game.tick < spec.maxTicks) {
    m.step();
    game.drainEvents();
    game.drainChangedTiles();
    if (game.phase !== 'playing') continue;
    for (const n of game.nations) {
      if (!n.alive || n.difficulty === null) continue;
      living[n.difficulty]++;
      if (n.troops > MAX_RATIO * maxTroops(game, n)) atMax[n.difficulty]++;
    }
  }

  const ranking = game.nations
    .filter((n) => n.difficulty !== null)
    .map((n) => ({ id: n.id, difficulty: n.difficulty as Difficulty, tiles: n.tiles }))
    .sort((a, b) => b.tiles - a.tiles || a.id - b.id);
  let winner: Difficulty | null = null;
  if (game.result) winner = game.nations[game.result.winners[0]].difficulty;
  else if (ranking.length > 0 && ranking[0].tiles > 0) winner = ranking[0].difficulty;

  const timeAtMaxShare = { easy: 0, normal: 0, hard: 0, insane: 0 };
  for (const d of DIFFICULTIES) timeAtMaxShare[d] = living[d] === 0 ? 0 : atMax[d] / living[d];
  return { winner, ranking, ticks: game.tick, timeAtMaxShare };
}

/** `perTeam` bots of difficulty `a` against `perTeam` of `b`, once per seed. */
export function headToHead(
  a: Difficulty,
  b: Difficulty,
  seeds: number[],
  size: MapSize,
  perTeam = 4,
  maxTicks = 6000,
): HeadToHead {
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  const atMaxSum: Partial<Record<Difficulty, number>> = { [a]: 0, [b]: 0 };
  for (const seed of seeds) {
    const r = runMatch({ seed, size, teams: [{ difficulty: a, count: perTeam }, { difficulty: b, count: perTeam }], maxTicks });
    if (r.winner === a) aWins++;
    else if (r.winner === b) bWins++;
    else draws++;
    for (const d of [a, b]) atMaxSum[d] = (atMaxSum[d] ?? 0) + r.timeAtMaxShare[d];
  }
  const n = Math.max(1, seeds.length);
  const timeAtMaxShare: Partial<Record<Difficulty, number>> = {};
  for (const d of [a, b]) timeAtMaxShare[d] = (atMaxSum[d] ?? 0) / n;
  return { aWins, bWins, draws, rateA: aWins / n, timeAtMaxShare };
}

/** The teams' difficulties, one from each team in turn until every team is used up. */
function interleave(teams: ArenaSpec['teams']): Difficulty[] {
  const left = teams.map((t) => t.count);
  const out: Difficulty[] = [];
  for (let more = true; more; ) {
    more = false;
    teams.forEach((t, i) => {
      if (left[i] > 0) {
        out.push(t.difficulty);
        left[i]--;
        more = true;
      }
    });
  }
  return out;
}
