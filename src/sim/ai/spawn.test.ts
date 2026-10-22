import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../shared/types';
import { Game } from '../core/game';
import { createGameMap } from '../map/gameMap';
import type { GameMap } from '../map/gameMap';
import { distance, tileOf } from '../map/grid';
import { generateRandomMap } from '../map/randomMap';
import { Match } from '../match';
import { spawnNation } from '../systems/spawn';
import { mapFromAscii } from '../testing/asciiMap';
import { Rng } from '../util/rng';
import { chooseSpawn } from './spawn';
import { DIFFICULTY } from './profile';

/** A 26×16 plains continent and a 2×2 plains island, on a 40×20 sea. */
function continentAndIsland(): GameMap {
  const rows: string[] = [];
  for (let y = 0; y < 20; y++) {
    let row = '';
    for (let x = 0; x < 40; x++) {
      const continent = x >= 2 && x < 28 && y >= 2 && y < 18;
      const island = x >= 33 && x < 35 && y >= 9 && y < 11;
      row += continent || island ? '#' : '.';
    }
    rows.push(row);
  }
  return mapFromAscii(rows);
}

const twoBots = (map: GameMap): Game =>
  new Game({ map, seed: 9, player: null, bots: [{ difficulty: 'insane' }, { difficulty: 'insane' }] });

describe('chooseSpawn', () => {
  it('insane spawns on a big continent rather than a tiny island', () => {
    const map = continentAndIsland();
    const continent = map.landmass[tileOf(map, 10, 10)];
    for (let seed = 1; seed <= 10; seed++) {
      const tile = chooseSpawn(twoBots(map), 1, DIFFICULTY.insane, new Rng(seed));
      expect(tile).not.toBeNull();
      expect(map.landmass[tile!]).toBe(continent);
    }
  });

  it('spawn respects spacing', () => {
    const map = continentAndIsland();
    const g = twoBots(map);
    const center = tileOf(map, 14, 10);
    expect(spawnNation(g, g.nations[2], center)).toEqual({ ok: true });
    for (const difficulty of ['easy', 'normal', 'hard', 'insane'] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const tile = chooseSpawn(g, 1, DIFFICULTY[difficulty], new Rng(seed));
        expect(tile).not.toBeNull();
        expect(distance(map, tile!, center)).toBeGreaterThanOrEqual(g.spawnSpacing);
        expect(g.owner[tile!]).toBe(0);
      }
    }
  });

  it('keeps clear of spawns chosen but not yet placed', () => {
    const map = continentAndIsland();
    const g = twoBots(map);
    const reserved = tileOf(map, 14, 10);
    for (let seed = 1; seed <= 5; seed++) {
      const tile = chooseSpawn(g, 1, DIFFICULTY.insane, new Rng(seed), [reserved]);
      expect(distance(map, tile!, reserved)).toBeGreaterThanOrEqual(g.spawnSpacing);
    }
  });

  it('returns null when no land is far enough from the other spawns', () => {
    const map = createGameMap(3, 1, new Uint8Array([1, 1, 1]));
    const g = twoBots(map);
    expect(spawnNation(g, g.nations[2], 1)).toEqual({ ok: true });
    expect(chooseSpawn(g, 1, DIFFICULTY.insane, new Rng(1))).toBeNull();
  });
});

describe('Match spawning', () => {
  it('spawns every bot at tick 0 without a rejected command', () => {
    const m = new Match({
      map: generateRandomMap(3, 'small'),
      seed: 3,
      player: null,
      bots: Array.from({ length: 12 }, (_, i) => ({ difficulty: (['easy', 'normal', 'hard', 'insane'] as const)[i % 4] })),
      spawnTicks: 50,
    });
    m.step();
    const events: GameEvent[] = m.game.drainEvents();
    expect(events.filter((e) => e.type === 'rejected')).toEqual([]);
    expect(m.game.phase).toBe('spawn');
    expect(m.game.alive().filter((n) => n.spawned)).toHaveLength(12);
  });
});
