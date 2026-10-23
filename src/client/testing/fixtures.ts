import { DEFAULT_RULES } from '../../shared/rules';
import type { NationSnap } from '../../worker/protocol';
import { MapInfo } from '../mapInfo';
import { ClientState } from '../state';

/** A nation snapshot with plain defaults. */
export function nationSnap(id: number, over: Partial<NationSnap> = {}): NationSnap {
  return {
    id, troops: 1000, maxTroops: 5000, gold: 1000, income: 1, tiles: 0, alive: true, spawned: true,
    relationToPlayer: 'neutral', embargoed: false, allies: [], attackingPlayer: 0, label: null,
    stats: { peakTiles: 0, tilesCaptured: 0, buildingsBuilt: 0, goldEarned: 0 }, ...over,
  };
}

/**
 * A playing client state from ASCII rows: in `map`, `.` is water and anything else land; in `owners`, `a`–`z` are
 * nations 1–26 (the player is 1) and `.` nobody. Every nation named gets a snapshot with its tile count.
 */
export function makeClientState(map: string[], owners: string[], nations: Partial<NationSnap>[] = []): { state: ClientState; info: MapInfo } {
  const width = map[0].length;
  const height = map.length;
  const terrain = new Uint8Array(width * height);
  const owner = new Uint16Array(width * height);
  let count = nations.length;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      terrain[y * width + x] = map[y][x] === '.' ? 0 : 1;
      const c = owners[y]?.[x] ?? '.';
      if (c !== '.') {
        owner[y * width + x] = c.charCodeAt(0) - 96;
        count = Math.max(count, c.charCodeAt(0) - 96);
      }
    }
  }
  const state = new ClientState();
  state.applyInit({
    width, height, terrain, playerId: 1, spawnEndsAt: 0, look: { latitude: { top: 72, bottom: -72 }, seed: 1, dryBands: false },
    rules: { ...DEFAULT_RULES },
    nations: Array.from({ length: count }, (_, i) => ({
      id: i + 1, name: `N${i + 1}`, color: 0x808080, isPlayer: i === 0, team: 0,
    })),
  });
  state.owner.set(owner);
  state.phase = 'playing';
  for (let id = 1; id <= count; id++) {
    let tiles = 0;
    for (const o of owner) if (o === id) tiles++;
    state.nations.set(id, nationSnap(id, { tiles, ...nations[id - 1] }));
  }
  return { state, info: new MapInfo(width, height, terrain) };
}
