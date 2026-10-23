import { describe, expect, it } from 'vitest';
import type { Command, GameEvent, GameResult, NationId, TileIndex } from '../../shared/types';
import { Game } from '../core/game';
import type { Nation } from '../core/nation';
import { isLand } from '../map/grid';
import { generateRandomMap } from '../map/randomMap';
import { makeTestGame } from '../testing/fixtures';
import { checkVictory } from './victory';

const attack = (nation: NationId, tile: TileIndex, ratio: number): Command => ({ type: 'attack', nation, tile, ratio });

const gameOvers = (events: GameEvent[]) => events.filter((e) => e.type === 'gameOver');

describe('checkVictory', () => {
  it('is null while no condition holds', () => {
    const g = makeTestGame({ map: ['####'], owners: ['ab..'], nations: [{}, {}], victory: true });
    expect(checkVictory(g)).toBeNull();
  });

  it('measures the land share against land tiles only', () => {
    // a holds 8 of 10 land tiles, but only 8 of 14 tiles
    const g = makeTestGame({ map: ['##########....'], owners: ['aaaaaaaa.b....'], nations: [{}, {}], victory: true });
    expect(checkVictory(g)).toEqual({ winners: [1], reason: 'landShare' });
    g.setOwner(7, 0);
    expect(checkVictory(g)).toBeNull();
  });

  it('checks the land share before the other conditions', () => {
    const alone = makeTestGame({ map: ['#####'], owners: ['aaaa.'], nations: [{}], victory: true });
    expect(checkVictory(alone)).toEqual({ winners: [1], reason: 'landShare' });
    const allies = makeTestGame({ map: ['#####'], owners: ['baaaa'], nations: [{}, {}], victory: true });
    allies.relations.set(1, 2, 'allied');
    expect(checkVictory(allies)).toEqual({ winners: [1], reason: 'landShare' });
  });

  it('the last nation alive wins; the dead and the unowned placeholder never count', () => {
    const g = makeTestGame({ map: ['#####'], owners: ['a....'], nations: [{}, { alive: false }], victory: true });
    expect(checkVictory(g)).toEqual({ winners: [1], reason: 'lastStanding' });
    g.nations[1].alive = false;
    expect(checkVictory(g)).toBeNull();
  });

  it('several survivors all allied with each other win together, in id order', () => {
    const g = makeTestGame({
      map: ['########'], owners: ['abcd....'], nations: [{}, {}, {}, {}], victory: true,
    });
    g.relations.set(3, 1, 'allied');
    g.relations.set(1, 2, 'allied');
    g.relations.set(2, 3, 'allied');
    // d isn't in the alliance
    expect(checkVictory(g)).toBeNull();
    g.relations.set(1, 4, 'allied');
    g.relations.set(2, 4, 'allied');
    expect(checkVictory(g)).toBeNull();
    // ... until it is
    g.relations.set(3, 4, 'allied');
    expect(checkVictory(g)).toEqual({ winners: [1, 2, 3, 4], reason: 'alliance' });
  });

  it('a dead nation outside the alliance does not block it', () => {
    const g = makeTestGame({ map: ['####'], owners: ['a.b.'], nations: [{}, { alive: false }, {}], victory: true });
    g.relations.set(1, 3, 'allied');
    expect(checkVictory(g)).toEqual({ winners: [1, 3], reason: 'alliance' });
  });

  it('free-for-all results have no team field', () => {
    const share = makeTestGame({ map: ['#####'], owners: ['aaaa.'], nations: [{}], victory: true });
    const alone = makeTestGame({ map: ['#####'], owners: ['a....'], nations: [{}, { alive: false }], victory: true });
    const allies = makeTestGame({ map: ['####'], owners: ['a..b'], nations: [{}, {}], victory: true });
    allies.relations.set(1, 2, 'allied');
    for (const g of [share, alone, allies]) expect(Object.keys(checkVictory(g)!)).toEqual(['winners', 'reason']);
  });
});

describe('checkVictory with teams', () => {
  /** Ten land tiles; a and b on team 1, c on team 2. */
  const teams = (owners: string, nations: Partial<Nation>[] = [{}, {}, {}]): Game =>
    makeTestGame({ map: ['##########'], owners: [owners], nations, victory: true, teams: [1, 1, 2] });

  it('teams: a team holding the win share together wins, its knocked-out members included', () => {
    // a and b hold 4 tiles each: neither alone has 80%, together they do
    expect(checkVictory(teams('aaaabbbbc.'))).toEqual({ winners: [1, 2], reason: 'landShare', team: 1 });
    // b is out; a holds 80% and wins with b
    expect(checkVictory(teams('aaaaaaaac.', [{}, { alive: false }, {}])))
      .toEqual({ winners: [1, 2], reason: 'landShare', team: 1 });
    // the other team, at 80% with team 1 still alive
    expect(checkVictory(teams('abcccccccc'))).toEqual({ winners: [3], reason: 'landShare', team: 2 });
  });

  it('teams: only living members count toward the share', () => {
    // b is out but still marked on 4 tiles: a's 4 alone fall short
    expect(checkVictory(teams('aaaabbbbc.', [{}, { alive: false }, {}]))).toBeNull();
  });

  it('teams: the last team with living members wins', () => {
    expect(checkVictory(teams('ab........', [{}, {}, { alive: false }])))
      .toEqual({ winners: [1, 2], reason: 'lastStanding', team: 1 });
    // one living member is enough, and the knocked-out ones win with it
    expect(checkVictory(teams('.b........', [{ alive: false }, {}, { alive: false }])))
      .toEqual({ winners: [1, 2], reason: 'lastStanding', team: 1 });
    expect(checkVictory(teams('c.........', [{ alive: false }, { alive: false }, {}])))
      .toEqual({ winners: [3], reason: 'lastStanding', team: 2 });
  });

  it('teams: no winner while two teams have living members below the share', () => {
    expect(checkVictory(teams('aaabbbcc..'))).toBeNull();
    expect(checkVictory(teams('a.......c.', [{}, { alive: false }, {}]))).toBeNull();
    // nobody left at all
    expect(checkVictory(teams('..........', [{ alive: false }, { alive: false }, { alive: false }]))).toBeNull();
  });

  it('teams: the win share comes from the rules', () => {
    const g = makeTestGame({
      map: ['##########'], owners: ['aaabbbcc..'], nations: [{}, {}, {}], victory: true, teams: [1, 1, 2],
      rules: { winShare: 0.6 },
    });
    expect(checkVictory(g)).toEqual({ winners: [1, 2], reason: 'landShare', team: 1 });
  });
});

describe('victory in Game.step', () => {
  it('80% land share wins', () => {
    // a holds 7 of 10 land tiles and takes an 8th; b survives elsewhere
    const g = makeTestGame({
      map: ['##########....'], owners: ['aaaaaaa..b....'], nations: [{ troops: 1000 }, { troops: 100 }], victory: true,
    });
    g.queue(attack(1, 7, 0.5));
    g.step();
    expect(g.nations[1].tiles).toBe(8);
    expect(g.nations[2].alive).toBe(true);
    const result: GameResult = { winners: [1], reason: 'landShare' };
    expect(g.result).toEqual(result);
    expect(g.phase).toBe('ended');
    expect(gameOvers(g.drainEvents())).toEqual([{ type: 'gameOver', result }]);
  });

  it('last nation standing wins', () => {
    // a takes b's only tile; the island keeps a far from 80%
    const g = makeTestGame({
      map: ['##.#####'], owners: ['ab......'], nations: [{ troops: 1000 }, { troops: 0 }], victory: true,
    });
    g.queue(attack(1, 1, 0.5));
    g.step();
    expect(g.nations[2].alive).toBe(false);
    const result: GameResult = { winners: [1], reason: 'lastStanding' };
    expect(g.result).toEqual(result);
    expect(g.phase).toBe('ended');
    expect(g.drainEvents()).toContainEqual({ type: 'gameOver', result });
  });

  it('two allied survivors trigger alliance victory', () => {
    const g = makeTestGame({ map: ['####'], owners: ['a..b'], nations: [{}, {}], victory: true });
    g.relations.set(1, 2, 'allied');
    g.step();
    const result: GameResult = { winners: [1, 2], reason: 'alliance' };
    expect(g.result).toEqual(result);
    expect(g.phase).toBe('ended');
    expect(gameOvers(g.drainEvents())).toEqual([{ type: 'gameOver', result }]);
  });

  it('never ends the game when the check is off', () => {
    const g = makeTestGame({ map: ['###'], owners: ['aaa'], nations: [{}] });
    for (let i = 0; i < 5; i++) g.step();
    expect(g.phase).toBe('playing');
    expect(g.result).toBeNull();
    expect(gameOvers(g.drainEvents())).toEqual([]);
  });

  it('eliminated player: commands rejected, sim continues to a result', () => {
    // nation 1 stands in for the player: one tile and no troops, between bots 2 and 3. The unowned island keeps 80%
    // of the land out of reach, so only the last nation standing can end the game.
    const g = makeTestGame({
      map: ['######.####'],
      owners: ['abbccc.....'],
      nations: [{ isPlayer: true, troops: 0 }, { troops: 1000 }, { troops: 0 }],
      victory: true,
    });
    g.playerId = 1;
    g.queue(attack(2, 0, 0.1));
    g.step();
    expect(g.nations[1].alive).toBe(false);
    expect(g.drainEvents()).toContainEqual({ type: 'eliminated', nation: 1, by: 2 });
    expect(g.phase).toBe('playing');

    // the player keeps clicking; every command is rejected while the bots fight on
    g.queue(attack(2, 3, 0.5));
    const events: GameEvent[] = [];
    let playerCommands = 0;
    for (let i = 0; i < 30 && g.phase === 'playing'; i++) {
      g.queue(attack(1, 3, 0.5));
      playerCommands++;
      g.step();
      events.push(...g.drainEvents());
    }
    const playerRejections = events.filter((e) => e.type === 'rejected' && e.nation === 1);
    expect(playerRejections).toHaveLength(playerCommands);
    expect(playerRejections.every((e) => e.type === 'rejected' && e.reason === 'eliminated')).toBe(true);
    expect(events.filter((e) => e.type === 'rejected' && e.nation !== 1)).toEqual([]);
    expect(g.owner[0]).toBe(2);

    const result: GameResult = { winners: [2], reason: 'lastStanding' };
    expect(g.phase).toBe('ended');
    expect(g.result).toEqual(result);
    expect(g.nations[3].alive).toBe(false);
    expect(gameOvers(events)).toEqual([{ type: 'gameOver', result }]);
  });

  it('step is a no-op after the game ends', () => {
    // a alone wins at once, with an attack on the unowned land still under way
    const g = makeTestGame({ map: ['######'], owners: ['a.....'], nations: [{ troops: 1000 }], victory: true, debug: true });
    g.queue(attack(1, 1, 0.5));
    g.step();
    const result: GameResult = { winners: [1], reason: 'lastStanding' };
    expect(g.result).toEqual(result);
    expect(g.phase).toBe('ended');
    // the step that ends the game still advances the clock
    expect(g.tick).toBe(1);
    expect(g.attacks).toHaveLength(1);
    expect(gameOvers(g.drainEvents())).toEqual([{ type: 'gameOver', result }]);
    g.drainChangedTiles();

    const n = g.nations[1];
    const snapshot = () => ({
      tick: g.tick, phase: g.phase, result: g.result, owner: g.owner.slice(),
      nation: { troops: n.troops, gold: n.gold, tiles: n.tiles, tradeIncome: n.tradeIncome, stats: { ...n.stats } },
      attacks: g.attacks.map((a) => ({ troops: a.troops, progress: a.progress, queued: [...a.queued] })),
    });
    n.tradeIncome = 10;
    const before = snapshot();
    for (let i = 0; i < 10; i++) {
      g.queue(attack(1, 4, 0.5));
      g.queue({ type: 'debugGrant', nation: 1, gold: 100, troops: 100 });
      g.step();
    }
    expect(snapshot()).toEqual(before);
    expect(g.drainEvents()).toEqual([]);
    expect(g.drainChangedTiles()).toEqual([]);
  });
});

describe('determinism', () => {
  /** The first unowned land tile in row-major order, or -1 when there is none. */
  const unownedLand = (g: Game): TileIndex => {
    for (let t = 0; t < g.owner.length; t++) if (g.owner[t] === 0 && isLand(g.map, t)) return t;
    return -1;
  };

  it('same seed + same commands ⇒ identical owner arrays after 300 ticks', () => {
    const map = generateRandomMap(5, 'small');
    const expandTicks = [2, 50, 120];
    const play = () => {
      const g = new Game({
        map, seed: 11, player: null, spawnTicks: 1, checkVictory: false,
        bots: Array.from({ length: 4 }, () => ({ difficulty: 'normal' as const })),
      });
      let spawnTiles: number[] = [];
      for (let i = 0; i < 300; i++) {
        if (g.tick === 2) spawnTiles = g.nations.map((n) => n.tiles);
        if (expandTicks.includes(g.tick)) {
          for (const n of g.alive()) g.queue(attack(n.id, unownedLand(g), 0.5));
        }
        g.step();
      }
      return {
        tick: g.tick,
        spawnTiles,
        owner: g.owner,
        nations: g.nations.map((n) => ({ alive: n.alive, troops: n.troops, gold: n.gold, tiles: n.tiles })),
      };
    };
    const first = play();
    const second = play();
    expect(first.tick).toBe(300);
    expect(second.owner).toEqual(first.owner);
    expect(second.nations).toEqual(first.nations);
    // the script really played: all four bots are alive, and each one grew well beyond its spawn disk
    expect(first.nations.filter((n) => n.alive)).toHaveLength(4);
    first.nations.slice(1).forEach((n, i) => expect(n.tiles).toBeGreaterThan(2 * first.spawnTiles[i + 1]));
  });
});
