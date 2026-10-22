// Starting values; Task 29 tunes them
export const CONFIG = {
  tickMs: 100,
  map: { sizes: { small: [400, 250], medium: [800, 450], large: [1200, 650] }, landFraction: 0.4, mountainShare: 0.12, hillShare: 0.23, navCellSize: 8 },
  spawn: {
    phaseTicks: 100, radius: 4, minDistance: 30, minDistanceFloor: 6, startTroops: 2500, startGold: 500,
    // spacing = sqrt(landCount / (nations * spacingSharesPerNation)): the side of a square holding 1/n of a nation's fair share
    spacingSharesPerNation: 4,
    // random spawns: land tiles tried per spacing level, and the factor the spacing shrinks by when none qualifies
    randomSamples: 2000, spacingRelax: 0.75,
  },
  win: { landShare: 0.8 },
  troops: { baseMax: 5000, perTile: 40, baseGrowth: 2, growthRate: 0.02, overMaxDecay: 0.01 },
  gold: { base: 1, perTile: 0.02 },
  combat: { terrainCost: [0, 1.0, 1.5, 2.5], neutralCost: 2, baseCost: 3, densityFactor: 1.2,
            defenderLossFactor: 1, frontFraction: 0.25, minTilesPerTick: 1, maxTilesPerTick: 80 },
  buildings: {
    minSpacing: 3, costGrowth: 1,
    city: { cost: 1000, buildTicks: 50, maxTroops: 25000 },
    factory: { cost: 1000, buildTicks: 50, gold: 8 },
    barracks: { cost: 1500, buildTicks: 50, growthBonus: 0.15 },
    bank: { cost: 2000, buildTicks: 60, gold: 6, tradeBonus: 0.1 },
    defensePost: { cost: 1500, buildTicks: 40, radius: 15, multiplier: 1.6 },
    fortress: { cost: 6000, buildTicks: 100, radius: 25, multiplier: 2.5 },
    port: { cost: 2500, buildTicks: 60, boatCapBonus: 2, tradeEveryTicks: 150 },
    navalBase: { cost: 4000, buildTicks: 80 },
    airport: { cost: 5000, buildTicks: 100, range: 150, tradeEveryTicks: 200 },
    antiAir: { cost: 2500, buildTicks: 50, radius: 20, hitChance: 0.15 },
    radar: { cost: 3000, buildTicks: 60, radius: 60, boost: 1.5 },
  },
  units: {
    troopBoat: { speed: 1.0, baseCap: 3 },
    tradeShip: { speed: 0.8, goldBase: 50, goldPerTile: 1 },
    warship: { cost: 3000, buildTicks: 60, speed: 0.8, hp: 10, range: 12, hitChance: 0.3, patrolRadius: 30 },
    tradePlane: { speed: 2.5, goldBase: 60, goldPerTile: 1.2 },
    bomber: { cost: 2500, speed: 2, hp: 3, radius: 4, killFactor: 0.5, cooldownTicks: 100 },
    paraPlane: { cost: 1500, speed: 2, hp: 3, maxTroopsShare: 0.3, cooldownTicks: 100 },
    fighter: { cost: 3000, buildTicks: 60, speed: 3, hp: 4, range: 30, detect: 25, hitChance: 0.3 },
  },
  diplomacy: { requestTtlTicks: 300, defaultTrust: 0.5, betrayalTrustPenalty: 0.5, trustRecoveryPerTick: 0.0005 },
  ai: { buildingTileValue: 40, neutralBias: 1.5, minAttackScore: 0.01, secondFrontPenalty: 0.4, gangUpShare: 0.35,
        counterRiskWeight: 2, minParaTroops: 2000, proposalCooldownTicks: 300, saveHorizonTicks: 300 },
  client: { labelEveryTicks: 20, maxCatchUpTicks: 8 },
} as const;
