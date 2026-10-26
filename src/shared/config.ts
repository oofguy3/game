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
    /** Ticks after the war begins during which nations that have not attacked another nation cannot be attacked. */
    protectTicks: 600,
  },
  tribes: { radius: 2, troops: 800, gold: 0, spacing: 16, thinkTicks: 15, expandRatio: 0.4 },
  win: { landShare: 0.8 },
  troops: { baseMax: 5000, perTile: 40, baseGrowth: 2, growthRate: 0.02, overMaxDecay: 0.01 },
  // tradeIncomeDecay: per-tick factor of the trade income moving average; trade gold adds gold × (1 − it)
  gold: { base: 1, perTile: 0.02, tradeIncomeDecay: 0.99 },
  combat: { terrainCost: [0, 1.0, 1.5, 2.5], neutralCost: 2, baseCost: 3, densityFactor: 1.2,
            defenderLossFactor: 1, frontFraction: 0.25, minTilesPerTick: 1, maxTilesPerTick: 80,
            // smallest share of troops an attack command sends; random tie-break added to frontier priorities;
            // frontier tiles estimateConquest averages over
            minAttackRatio: 0.01, frontierJitter: 0.5, estimateSamples: 64 },
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
    missileSilo: { cost: 12000, buildTicks: 100 },
    samLauncher: { cost: 7000, buildTicks: 60, radius: 18 },
  },
  nukes: {
    atom: { cost: 25000, radius: 6, speed: 8 },
    hydrogen: { cost: 55000, radius: 12, speed: 6 },
    mirv: { cost: 90000, radius: 5, speed: 8, warheads: 3, spread: 7 },
    /** Ticks a silo must rest after it fires. Each silo has its own timer, so another silo can fire sooner. */
    cooldownTicks: 250,
    /** Gold to scrub one fallout tile. */
    cleanCost: 500,
    cleanRadius: 3,
  },
  units: {
    troopBoat: { speed: 1.0, baseCap: 3 },
    // partners whose port lies preferredMin–preferredMax tiles away are picked at full weight, others at offRangeWeight
    tradeShip: { speed: 0.8, goldBase: 50, goldPerTile: 1, preferredMin: 50, preferredMax: 300, offRangeWeight: 0.25 },
    warship: { cost: 3000, buildTicks: 60, speed: 0.8, hp: 10, range: 12, hitChance: 0.3, patrolRadius: 30 },
    tradePlane: { speed: 2.5, goldBase: 60, goldPerTile: 1.2 },
    bomber: { cost: 2500, speed: 2, hp: 3, radius: 4, killFactor: 0.5, cooldownTicks: 100 },
    paraPlane: { cost: 1500, speed: 2, hp: 3, maxTroopsShare: 0.3, cooldownTicks: 100 },
    fighter: { cost: 3000, buildTicks: 60, speed: 3, hp: 4, range: 30, detect: 25, hitChance: 0.3 },
  },
  diplomacy: {
    requestTtlTicks: 300, defaultTrust: 0.5, betrayalTrustPenalty: 0.5, trustRecoveryPerTick: 0.0005,
    /** How long a nation that broke an alliance is marked TRAITOR, and the capture-cost multiplier against it. */
    traitorTicks: 300, traitorAttackCost: 0.5,
  },
  ai: { buildingTileValue: 40, neutralBias: 1.5, minAttackScore: 0.01, secondFrontPenalty: 0.4, gangUpShare: 0.35,
        counterRiskWeight: 1, minParaTroops: 2000, proposalCooldownTicks: 300, saveHorizonTicks: 300,
        // shared-border tiles per neighbour whose defense multiplier perception averages
        defenseSamples: 16,
        // reserve held per incoming attacking troop; share of a stronger neutral neighbour's troops treated as a threat;
        // the most of the troop cap a reserve may claim
        incomingReserve: 1.2, strongNeutralShare: 0.3, reserveCap: 0.8,
        // share of the troops above the reserve sent into free land while inside the troop band
        expandShare: 0.5,
        // a counterattack sends this many troops per troop attacking us
        counterattackFactor: 1.1,
        // an attack gets at most the troops it can spend in this many of the bot's decision intervals, unless troops
        // fill this share of the cap (saturated): then each target gets at least its share of the budget
        paceMargin: 2, saturatedRatio: 0.9,
        // most attacks a bot starts or tops up in one decision
        maxAttacksPerThink: 3,
        // spawn choice: landmass size worth full marks (and their weight), spacing multiples worth full marks, the
        // radius and weight of the plains share, and random draws allowed per wanted sample
        spawnLandmassTarget: 2000, spawnLandmassWeight: 2, spawnSpacingReach: 3, spawnPlainsRadius: 6,
        spawnPlainsWeight: 0.5, spawnDrawsPerSample: 20, spawnMinDraws: 2000,
        // building plans: ticks of income a per-tick benefit is counted over; how much a stronger enemy at the
        // border boosts defenses
        buildHorizonTicks: 600, defenseUrgency: 4,
        // a neutral neighbour this many times stronger than us counts as a threat to build defenses against
        strongNeutralThreat: 1.5,
        // building placement: own tiles sampled for interior spots (from a search of this many tiles around the
        // centroid), border tiles sampled, and how far inland front defenses sit
        interiorSamples: 60, interiorSearch: 600, borderSamples: 200, frontInset: 3,
        // sea invasions: distance (tiles) that halves a target's appeal, coastal tiles sampled per water body, our
        // coastal border tiles measured from, and how long a scan of overseas targets is reused
        invasionDistanceScale: 100, invasionCoastSamples: 3000, invasionShoreSamples: 24, overseasRefreshTicks: 60,
        // naval defense: how long an invasion by sea keeps a bot alert, how much it values a naval base meanwhile,
        // and how many warships it keeps per naval base
        navalThreatTicks: 600, navalUrgency: 60, warshipsPerBase: 2,
        // ports are worth this much more when there is somewhere overseas to invade
        portInvasionBonus: 1.5,
        // air: per-tick worth of a first airport with an enemy in its range, of each exposed building an anti-air gun
        // would cover and of each anti-air gun a radar would cover
        airportValue: 12, antiAirValue: 4, radarValue: 3,
        // airports sit at least this deep behind the border; own tiles searched around the centroid and sampled
        airportDepth: 20, airportSearch: 2400, airportSamples: 300,
        // how far from a cluster's centre an anti-air gun or radar may go
        siteSearch: 10,
        // bombing first: the front defense worth softening, and how far behind the border its defenses may stand;
        // paradrops: how far behind the front a target must be, and the radius that groups buildings into a cluster
        bombDefense: 1.2, bombReach: 25, paraDepth: 15, paraClusterRadius: 10,
        // diplomacy: the least trust for an alliance; a partner this strong relative to us (or a diplomacy weight this
        // high) makes one worth having; incoming troops (share of ours) that make peace worth asking for; a joint
        // attack's target must score this share of our best target
        allyTrust: 0.3, allyStrength: 0.7, allyDiplomacy: 1.2, peaceIncomingShare: 0.5, jointAttackShare: 0.5,
        // deals: troops are worth this much more at war; gold idle for this many ticks of income buys troops, spending
        // up to dealGoldShare of it on at most dealTroopShare of the seller's troops, at dealMargin over their worth
        warTroopValue: 1.5, richIncomeTicks: 300, dealGoldShare: 0.5, dealTroopShare: 0.3, dealMargin: 1.25,
        // betrayal: the least betrayal weight; an ally must score this many times the next target and have at most
        // this share of our density
        betrayalWeight: 0.5, betrayalScore: 2, betrayalDensity: 0.6 },
  client: { labelEveryTicks: 20, maxCatchUpTicks: 8 },
} as const;
