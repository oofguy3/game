import { BUILDING_TYPES } from '../../shared/types';
import type { BuildingType, Difficulty, NationId, Personality, TileIndex } from '../../shared/types';

export interface Nation {
  id: NationId;
  name: string;
  /** 0xRRGGBB. */
  color: number;
  isPlayer: boolean;
  /** 1–4 in teams mode, 0 in free-for-all. */
  team: number;
  difficulty: Difficulty | null;
  personality: Personality | null;
  alive: boolean;
  spawned: boolean;
  /** -1 until the nation has spawned. */
  spawnTile: TileIndex;
  troops: number;
  gold: number;
  /** Moving average of gold earned from trade, per tick. */
  tradeIncome: number;
  tiles: number;
  /** Owned tiles with a 4-neighbour not owned by this nation (water counts; the map edge doesn't). */
  border: Set<TileIndex>;
  /** Sums of the x and y coordinates of owned tiles, for centroid labels. */
  sumX: number;
  sumY: number;
  /** Active buildings only. */
  buildingCounts: Record<BuildingType, number>;
  stats: { peakTiles: number; tilesCaptured: number; buildingsBuilt: number; goldEarned: number };
}

export function emptyBuildingCounts(): Record<BuildingType, number> {
  const counts = {} as Record<BuildingType, number>;
  for (const type of BUILDING_TYPES) counts[type] = 0;
  return counts;
}

/** A living, unspawned nation with nothing owned, on no team. */
export function createNation(
  init: Pick<Nation, 'id' | 'name' | 'color' | 'isPlayer' | 'difficulty' | 'personality'>,
): Nation {
  return {
    ...init,
    team: 0,
    alive: true,
    spawned: false,
    spawnTile: -1,
    troops: 0,
    gold: 0,
    tradeIncome: 0,
    tiles: 0,
    border: new Set(),
    sumX: 0,
    sumY: 0,
    buildingCounts: emptyBuildingCounts(),
    stats: { peakTiles: 0, tilesCaptured: 0, buildingsBuilt: 0, goldEarned: 0 },
  };
}
