import { describe, expect, it } from 'vitest';
import { nationColor, PLAYER_COLOR, teamColor } from '../../shared/colors';
import { DEFAULT_RULES, minBots } from '../../shared/rules';
import type { MatchRules } from '../../shared/rules';
import type { Difficulty } from '../../shared/types';
import { mapFromAscii } from '../testing/asciiMap';
import { Rng } from '../util/rng';
import { Game } from './game';
import type { GameSetup } from './game';
import { assignTeams, sameTeam, TEAM_RNG_SALT, teamSizes } from './teams';

const TEAMS_RULES: MatchRules = { ...DEFAULT_RULES, mode: 'teams', teams: 2 };

const setup = (bots: number, rules: MatchRules, seed = 9): GameSetup => ({
  map: mapFromAscii(['########']),
  seed,
  player: { name: 'You' },
  bots: Array.from({ length: bots }, () => ({ difficulty: 'normal' as Difficulty })),
  rules,
});

/** How many nations each team has, team 1 first. */
const sizesOf = (teams: Map<number, number>, count: number): number[] =>
  Array.from({ length: count }, (_, i) => [...teams.values()].filter((t) => t === i + 1).length);

describe('teamSizes', () => {
  it('teamSizes: sizes add up, differ by at most one, and the player’s team is never bigger', () => {
    for (let total = 2; total <= 41; total++) for (const teams of [2, 3, 4]) {
      if (total < 2 * teams) continue;
      const s = teamSizes(total, teams, true);
      expect(s.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
      expect(s[0]).toBe(Math.min(...s));
    }
    expect(teamSizes(13, 2, true)).toEqual([6, 7]);
    expect(teamSizes(13, 4, true)).toEqual([3, 4, 3, 3]);
  });

  it('without a player the first teams take the extra nations', () => {
    expect(teamSizes(13, 2, false)).toEqual([7, 6]);
    expect(teamSizes(14, 4, false)).toEqual([4, 4, 3, 3]);
    expect(teamSizes(40, 4, false)).toEqual([10, 10, 10, 10]);
  });

  it('with the bots raised to minBots, every team has at least 2 nations', () => {
    for (let bots = 1; bots <= 40; bots++) for (const teams of [2, 3, 4] as const) {
      const n = Math.min(40, Math.max(minBots({ ...DEFAULT_RULES, mode: 'teams', teams }), bots));
      expect(Math.min(...teamSizes(n + 1, teams, true))).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('assignTeams', () => {
  it('assignTeams: the player on team 1, sizes from teamSizes, the same for the same seed', () => {
    const bots = Array.from({ length: 12 }, (_, i) => i + 2);
    for (const teams of [2, 3, 4]) {
      const dealt = assignTeams(1, bots, teams, new Rng(3));
      expect(dealt.get(1)).toBe(1);
      expect([...dealt.keys()].sort((a, b) => a - b)).toEqual([1, ...bots]);
      expect(sizesOf(dealt, teams)).toEqual(teamSizes(13, teams, true));
      expect(assignTeams(1, bots, teams, new Rng(3))).toEqual(dealt);
    }
    // the bots are shuffled, not dealt in id order
    const seeds = [1, 2, 3, 4, 5].map((seed) => [...assignTeams(1, bots, 2, new Rng(seed)).entries()].join());
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('without a player, every bot is dealt and the first teams take the extra ones', () => {
    const bots = Array.from({ length: 9 }, (_, i) => i + 1);
    const dealt = assignTeams(0, bots, 4, new Rng(7));
    expect([...dealt.keys()].sort((a, b) => a - b)).toEqual(bots);
    expect(sizesOf(dealt, 4)).toEqual(teamSizes(9, 4, false));
  });
});

describe('a teams game', () => {
  it('a teams game: teammates start allied, others neutral, colours from the team families', () => {
    const g = new Game(setup(5, TEAMS_RULES));
    expect(g.nations[1].team).toBe(1);
    expect(g.nations[1].color).toBe(PLAYER_COLOR);
    const teams = g.nations.slice(1).map((n) => n.team);
    expect([1, 2].map((t) => teams.filter((x) => x === t).length)).toEqual(teamSizes(6, 2, true));
    for (let a = 1; a < g.nations.length; a++) {
      for (let b = 1; b < g.nations.length; b++) {
        if (a === b) continue;
        const together = g.nations[a].team === g.nations[b].team;
        expect(sameTeam(g, a, b)).toBe(together);
        expect(g.relations.get(a, b)).toBe(together ? 'allied' : 'neutral');
      }
    }
    // each nation a shade of its family, numbered within its team in id order
    const seen = [0, 0, 0];
    for (const n of g.nations.slice(1)) expect(n.color).toBe(teamColor(n.team, seen[n.team]++, n.isPlayer));
    expect(new Set(g.nations.slice(1).map((n) => n.color)).size).toBe(6);
    // locking the teams is quiet
    expect(g.drainEvents()).toEqual([]);
    // the same seed deals the same teams
    expect(new Game(setup(5, TEAMS_RULES)).nations.map((n) => n.team)).toEqual(g.nations.map((n) => n.team));
  });

  it('the deal comes from its own stream: the game’s stream is untouched', () => {
    const teams = new Game(setup(5, TEAMS_RULES));
    const ffa = new Game(setup(5, DEFAULT_RULES));
    expect(teams.rng.next()).toBe(ffa.rng.next());
    const dealt = assignTeams(1, [2, 3, 4, 5, 6], 2, new Rng(9).fork(TEAM_RNG_SALT));
    expect(teams.nations.slice(1).map((n) => n.team)).toEqual([1, 2, 3, 4, 5, 6].map((id) => dealt.get(id)));
  });

  it('explicit teams: nobody is shuffled and the player is on team 1', () => {
    const bots = [2, 1, 2, 1].map((team) => ({ difficulty: 'normal' as Difficulty, team }));
    const g = new Game({ ...setup(0, TEAMS_RULES), bots });
    expect(g.nations.slice(1).map((n) => n.team)).toEqual([1, 2, 1, 2, 1]);
    expect(g.relations.get(2, 4)).toBe('allied');
    expect(g.relations.get(1, 3)).toBe('allied');
    expect(g.relations.get(1, 2)).toBe('neutral');
    const arena = new Game({ ...setup(0, TEAMS_RULES), player: null, bots });
    expect(arena.nations.slice(1).map((n) => n.team)).toEqual([2, 1, 2, 1]);
    expect(arena.nations[2].color).toBe(teamColor(1, 0, false));
    // given teams must cover every bot, within the rules' team count
    const missing = [{ difficulty: 'normal' as Difficulty, team: 1 }, { difficulty: 'normal' as Difficulty }];
    expect(() => new Game({ ...setup(0, TEAMS_RULES), bots: missing })).toThrow(/Bot 1 has team undefined/);
    const tooHigh = [{ difficulty: 'normal' as Difficulty, team: 3 }];
    expect(() => new Game({ ...setup(0, TEAMS_RULES), bots: tooHigh })).toThrow(/Bot 0 has team 3/);
  });

  it('free-for-all: no teams, today’s colours, nobody allied', () => {
    const g = new Game(setup(5, DEFAULT_RULES));
    for (const n of g.nations.slice(1)) {
      expect(n.team).toBe(0);
      expect(n.color).toBe(nationColor(n.id, n.isPlayer));
    }
    expect(sameTeam(g, 2, 3)).toBe(false);
    expect(g.relations.get(2, 3)).toBe('neutral');
  });

  it('sameTeam is false for a nation with itself', () => {
    const g = new Game(setup(5, TEAMS_RULES));
    expect(sameTeam(g, 1, 1)).toBe(false);
  });
});
