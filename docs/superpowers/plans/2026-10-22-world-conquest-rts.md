# World-Conquest RTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-player, browser-based world-conquest strategy game. It has territory spread, 11 buildings, boats, planes, trading and alliances, and plays against strong AI bots at four difficulty levels. It deploys to GitHub Pages.

**Architecture:**
- A pure, deterministic TypeScript simulation (`src/sim`) advances in fixed 100 ms ticks. The player and every bot act only through the same `Command` objects.
- A `Match` (simulation + bot controllers) runs inside a Web Worker. The client (`src/client`) mirrors state from worker updates and draws it on a 2D canvas under HTML/CSS overlays.
- The same simulation runs headless in Node for unit tests, the AI arena and the perf check.

**Tech Stack:** TypeScript 6.0.3, Vite 8.3.4, Vitest 5.0.3, Playwright 1.56.1 (matches the preinstalled Chromium 1194), tsx 4.23.14, simplex-noise 4.0.3. Build-time only: topojson-client 3.1.0 and world-atlas 2.0.2. Hosting: GitHub Actions + Pages.

**Spec:** `docs/superpowers/specs/2026-10-22-world-conquest-rts-design.md`

## Global Constraints

**Repository and tooling**
- Work on branch `claude/clever-cray-5279az`. Commit after every task. Push after every milestone with `git push -u origin claude/clever-cray-5279az`.
- Node 22. Pin exact dependency versions, no `^`: vite 8.3.4, typescript 6.0.3, vitest 5.0.3, tsx 4.23.14, @playwright/test 1.56.1, simplex-noise 4.0.3, topojson-client 3.1.0, @types/topojson-client 3.1.5, world-atlas 2.0.2, @types/node 26.6.5.
- Tests sit next to their code as `src/**/*.test.ts`. Browser tests live in `e2e/`.
- Every commit message ends with the session's standard attribution trailer (Co-Authored-By + Claude-Session lines).

**Simulation rules**
- Code in `src/sim/**` and `src/shared/**` never touches the DOM, `Math.random`, `Date` or `performance`. All randomness comes from `Rng`, seeded from the match seed, so the same seed plus the same commands always gives the same game.
- Bots get no cheats. A bot reads `Game` state and returns `Command`s, which go through the same `applyCommand` validation as the player's.
- Every balance number lives in `CONFIG` in `src/shared/config.ts`. Systems and AI code contain no magic numbers.
- One tick is 100 ms at 1×. Speeds are 0 (pause), 1, 2 and 4.
- Terrain capture cost: plains 1.0, hills 1.5, mountains 2.5.
- Victory: 80% of land tiles, being the last nation standing, or alliance victory.
- Bots: 4–40. Difficulties: easy, normal, hard, insane. Personalities: aggressive, builder, trader, opportunist, diplomat.

**Game design**
- Mouse and keyboard controls, clean flat colors, no fog of war, no nukes.
- The placeholder game name exists only as `GAME_NAME = "Untitled Conquest"` in `src/shared/constants.ts`.
- Vite uses `base: '/game/'`. The world map is fetched from `${import.meta.env.BASE_URL}maps/world.bin`.

**Targets**
- Arena: each difficulty beats the next-lower one in ≥70% of head-to-head matches.
- Perf: on the world map with 30 insane bots, mean `Match.step()` time stays under 20 ms.

## Review Focus

1. **Invalid player input** must change nothing and emit exactly one `rejected` event with a readable reason. This covers clicking water, your own land, an ally, a tile off the map, an unaffordable or badly placed building, or an out-of-range air target. Tests: Tasks 8, 10, 18 and 21.
2. **Too many bots for the map.** With 40 bots on a small random map, every nation still spawns because spawn spacing relaxes. Test: Task 7.
3. **The player is eliminated mid-game.** Their commands are rejected, the simulation keeps running to a result, and the client marks the player defeated and offers "Keep watching". Tests: Tasks 9 and 16.
4. **A unit's destination becomes invalid mid-trip.** For example, the landing tile became the unit's own, the destination port was captured, or the home airport was lost. The unit returns its troops or despawns cleanly, with no crash and no payout. Tests: Tasks 18, 19 and 21.
5. **Background tab or 4× speed.** The worker caps catch-up ticks per wake-up so the game never spirals, and speed 0 runs zero ticks. Test: Task 15.

## Conventions used by every task

- **"Run tests → FAIL"** means `npx vitest run <the task's test files>` fails because the code doesn't exist yet.
- **"Run tests → PASS"** means the same command passes and `npm run typecheck` reports 0 errors.
- From Task 6 on, every simulation test builds its game with `makeTestGame` (Task 6) and `mapFromAscii` (Task 2).
- **"Commit"** means `git add -A && git commit -m "<message>"` with the attribution trailer.

---

## Milestone 1 — Foundation & maps

### Task 1: Scaffold, shared types, config, RNG, heap

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/client/main.ts`, `src/shared/types.ts`, `src/shared/config.ts`, `src/shared/constants.ts`, `src/sim/util/rng.ts`, `src/sim/util/heap.ts`
- Test: `src/sim/util/rng.test.ts`, `src/sim/util/heap.test.ts`

**Interfaces:**
- Produces: everything in `types.ts` and `config.ts` below.
- Produces: `class Rng { constructor(seed: number); next(): number /* [0,1) */; int(min: number, max: number): number /* inclusive */; chance(p: number): boolean; pick<T>(items: readonly T[]): T; fork(salt: number): Rng }`. Implemented as sfc32 seeded through splitmix32.
- Produces: `class MaxHeap { push(value: number, priority: number): void; pop(): number | undefined; peekPriority(): number; get size(): number; clear(): void }`. Stores values and priorities in parallel number arrays, never objects.

```ts
// src/shared/types.ts
export type NationId = number;   // 0 = unowned
export type TileIndex = number;  // y * width + x
export const Terrain = { Water: 0, Plains: 1, Hills: 2, Mountains: 3 } as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];
export type Difficulty = 'easy' | 'normal' | 'hard' | 'insane';
export type Personality = 'aggressive' | 'builder' | 'trader' | 'opportunist' | 'diplomat';
export type BuildingType = 'city' | 'factory' | 'barracks' | 'bank' | 'defensePost' | 'fortress'
  | 'port' | 'navalBase' | 'airport' | 'antiAir' | 'radar';
export const BUILDING_TYPES: readonly BuildingType[] = ['city', 'factory', 'barracks', 'bank', 'defensePost',
  'fortress', 'port', 'navalBase', 'airport', 'antiAir', 'radar'];
export type UnitType = 'troopBoat' | 'tradeShip' | 'warship' | 'tradePlane' | 'bomber' | 'paraPlane' | 'fighter';
export type Relation = 'neutral' | 'allied' | 'war';
export type Phase = 'spawn' | 'playing' | 'ended';
export type MapSize = 'small' | 'medium' | 'large';
export type MapChoice = { kind: 'world' } | { kind: 'random'; size: MapSize; seed: number };
export interface Deal { giveGold: number; giveTroops: number; getGold: number; getTroops: number }
export interface DiplomacyRequest {
  id: number; kind: 'alliance' | 'peace' | 'deal' | 'jointAttack'; from: NationId; to: NationId;
  expiresAt: number; deal?: Deal; target?: NationId;
}
export type Command =
  | { type: 'spawn'; nation: NationId; tile: TileIndex }
  | { type: 'attack'; nation: NationId; tile: TileIndex; ratio: number; allowBoat?: boolean }
  | { type: 'boat'; nation: NationId; tile: TileIndex; ratio: number }
  | { type: 'build'; nation: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'buildUnit'; nation: NationId; unit: 'warship' | 'fighter'; buildingId: number }
  | { type: 'moveUnit'; nation: NationId; unitId: number; tile: TileIndex }
  | { type: 'bomb'; nation: NationId; tile: TileIndex }
  | { type: 'paradrop'; nation: NationId; tile: TileIndex; ratio: number }
  | { type: 'proposeAlliance'; nation: NationId; to: NationId }
  | { type: 'breakAlliance'; nation: NationId; with: NationId }
  | { type: 'proposePeace'; nation: NationId; to: NationId }
  | { type: 'proposeDeal'; nation: NationId; to: NationId; deal: Deal }
  | { type: 'requestJointAttack'; nation: NationId; to: NationId; target: NationId }
  | { type: 'respond'; nation: NationId; requestId: number; accept: boolean }
  | { type: 'embargo'; nation: NationId; with: NationId; on: boolean }
  | { type: 'debugGrant'; nation: NationId; gold?: number; troops?: number }; // only when GameSetup.debug
export interface GameResult { winners: NationId[]; reason: 'landShare' | 'lastStanding' | 'alliance' }
export type GameEvent =
  | { type: 'rejected'; nation: NationId; reason: string }
  | { type: 'spawned'; nation: NationId; tile: TileIndex }
  | { type: 'phase'; phase: Phase }
  | { type: 'attackStarted'; attacker: NationId; target: NationId; troops: number }
  | { type: 'eliminated'; nation: NationId; by: NationId }
  | { type: 'buildingDone'; nation: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'buildingCaptured'; from: NationId; to: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'buildingDestroyed'; owner: NationId; by: NationId; building: BuildingType; tile: TileIndex }
  | { type: 'landed'; nation: NationId; tile: TileIndex; troops: number }
  | { type: 'unitLost'; owner: NationId; by: NationId; unit: UnitType }
  | { type: 'trade'; nation: NationId; partner: NationId; gold: number }
  | { type: 'radarWarning'; nation: NationId; from: NationId; unit: UnitType; tile: TileIndex }
  | { type: 'request'; request: DiplomacyRequest }
  | { type: 'requestResolved'; requestId: number; kind: DiplomacyRequest['kind']; from: NationId; to: NationId; accepted: boolean }
  | { type: 'relation'; a: NationId; b: NationId; relation: Relation }
  | { type: 'betrayal'; betrayer: NationId; victim: NationId }
  | { type: 'gameOver'; result: GameResult };
```

```ts
// src/shared/config.ts — starting values; Task 29 tunes them
export const CONFIG = {
  tickMs: 100,
  map: { sizes: { small: [400, 250], medium: [800, 450], large: [1200, 650] }, landFraction: 0.4, navCellSize: 8 },
  spawn: { phaseTicks: 100, radius: 4, minDistance: 30, minDistanceFloor: 6, startTroops: 2500, startGold: 500 },
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
  diplomacy: { requestTtlTicks: 300, betrayalTrustPenalty: 0.5, trustRecoveryPerTick: 0.0005 },
  ai: { buildingTileValue: 40, neutralBias: 1.5, minAttackScore: 0.01, secondFrontPenalty: 0.4, gangUpShare: 0.35,
        counterRiskWeight: 2, minParaTroops: 2000, proposalCooldownTicks: 300, saveHorizonTicks: 300 },
  client: { labelEveryTicks: 20, maxCatchUpTicks: 8 },
} as const;
```

- [ ] **Step 1: Create the scaffold files**
  - **`package.json`:** `"type": "module"`. Scripts:
    - `dev`: `vite`
    - `build`: `tsc --noEmit && vite build`
    - `preview`: `vite preview`
    - `typecheck`: `tsc --noEmit`
    - `test`: `vitest run`
    - `e2e`: `playwright test`
    - `arena`: `tsx scripts/arena.ts`
    - `perf`: `tsx scripts/perf.ts`
    - `build:world`: `tsx scripts/build-world-map.ts`
  - **Dependencies:** run `npm i -E simplex-noise@4.0.3`, then `npm i -D -E vite@8.3.4 typescript@6.0.3 vitest@5.0.3 tsx@4.23.14 @types/node@26.6.5`.
  - **`tsconfig.json`:** target ES2022, module ESNext, moduleResolution bundler, strict, noEmit, lib `["ES2022","DOM","DOM.Iterable"]`, types `["node","vite/client"]`, include `["src","scripts","e2e","*.ts"]`.
  - **`vite.config.ts`:** use `defineConfig` from `vitest/config`, with `base: '/game/'` and `test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'], testTimeout: 30000 }`.
  - **`.gitignore`:** `node_modules dist test-results playwright-report`.
  - **`index.html`:** loads `/src/client/main.ts`. **`main.ts`:** sets `document.title = GAME_NAME`.
  - **Source files:** write `types.ts`, `config.ts` and `constants.ts` from the blocks above.
- [ ] **Step 2: Write the failing tests**
```ts
// rng.test.ts
it('is deterministic per seed', () => { const a = new Rng(42), b = new Rng(42); expect([a.next(), a.next()]).toEqual([b.next(), b.next()]); });
it('differs across seeds', () => expect(new Rng(1).next()).not.toBe(new Rng(2).next()));
it('int is inclusive and in range', () => { const r = new Rng(7); const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) seen.add(r.int(3, 5)); expect([...seen].sort()).toEqual([3, 4, 5]); });
it('fork is deterministic', () => expect(new Rng(9).fork(1).next()).toBe(new Rng(9).fork(1).next()));
// heap.test.ts
it('pops highest priority first', () => { const h = new MaxHeap(); h.push(1, 5); h.push(2, 9); h.push(3, 1);
  expect([h.pop(), h.pop(), h.pop(), h.pop()]).toEqual([2, 1, 3, undefined]); });
it('handles 10k random pushes in order', () => { /* push 10k random priorities, pops are non-increasing */ });
```
- [ ] **Step 3:** Run tests → FAIL.
- [ ] **Step 4:** Implement `Rng` and `MaxHeap`.
- [ ] **Step 5:** Run tests → PASS. `npm run build` succeeds.
- [ ] **Step 6:** Commit `chore: scaffold project with shared types, config, rng and heap`.

### Task 2: Map model, grid helpers, codec, labels

**Files:**
- Create: `src/sim/map/grid.ts`, `src/sim/map/gameMap.ts`, `src/sim/map/codec.ts`, `src/sim/testing/asciiMap.ts`
- Test: `src/sim/map/gameMap.test.ts`, `src/sim/map/codec.test.ts`

**Interfaces:**
- Produces: `interface GameMap { width: number; height: number; terrain: Uint8Array; landCount: number; coastal: Uint8Array; waterBody: Int32Array /* -1 on land */; waterBodySize: number[]; landmass: Int32Array /* -1 on water */; landmassSize: number[] }`
- Produces: `createGameMap(width: number, height: number, terrain: Uint8Array): GameMap`. Labels come from an iterative (non-recursive) 4-neighbour flood fill. A tile is coastal when it is land with at least one water 4-neighbour; the map edge doesn't count as water.
- Produces (`grid.ts`):
  - `tileOf(map, x, y): TileIndex`, `xOf(map, t): number`, `yOf(map, t): number`, `inBounds(map, x, y): boolean`
  - `forEachNeighbor(map, t, fn: (n: TileIndex) => void): void`: 4-neighbourhood, no wrap
  - `isLand(map, t): boolean`
  - `distance(map, a, b): number`: Euclidean
- Produces (`codec.ts`): `encodeMap(map: GameMap): Uint8Array` and `decodeMap(bytes: Uint8Array): GameMap`. The format is ASCII `WMAP`, then u8 version 1, then u16 width and u16 height (little-endian), then RLE pairs of (u8 terrain, u16 run length).
- Produces (`asciiMap.ts`): `mapFromAscii(rows: string[]): GameMap`, where `.` is water, `#` plains, `^` hills and `M` mountains.

- [ ] **Step 1: Write the failing tests**
```ts
const m = mapFromAscii(['....', '.##.', '.#^.', '....']);
it('counts land and marks coast', () => { expect(m.landCount).toBe(3); expect(m.coastal[tileOf(m, 1, 1)]).toBe(1); });
it('labels one water body and one landmass', () => { expect(m.waterBodySize).toEqual([13]); expect(m.landmassSize).toEqual([3]); });
it('labels separate lakes', () => expect(mapFromAscii(['#####', '#.#.#', '#####']).waterBodySize).toEqual([1, 1]));
it('neighbours do not wrap', () => { const out: number[] = []; forEachNeighbor(m, 0, n => out.push(n)); expect(out.sort((a, b) => a - b)).toEqual([1, 4]); });
it('codec round-trips', () => { const d = decodeMap(encodeMap(m)); expect([d.width, d.height]).toEqual([4, 4]); expect([...d.terrain]).toEqual([...m.terrain]); });
it('codec rejects bad magic', () => expect(() => decodeMap(new Uint8Array(10))).toThrow(/WMAP/));
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(map): grid helpers, map labels and binary codec`.

### Task 3: Random map generator

**Files:** Create `src/sim/map/randomMap.ts`. Test: `src/sim/map/randomMap.test.ts`.

**Interfaces:**
- Consumes: `Rng`, `createGameMap`, `CONFIG.map`.
- Produces: `generateRandomMap(seed: number, size: MapSize): GameMap`.
- Produces: `applyRelief(terrain: Uint8Array, width: number, height: number, rng: Rng): void`. Within land, the top 12% of a second noise field becomes Mountains and the next 23% becomes Hills. Task 4 reuses this function.

The algorithm, which the tests alone don't pin down:
1. Start from `createNoise2D(() => rng.next())`.
2. height = fBm (5 octaves, base frequency 3/width) + gaussian bumps at 3–6 random continent centres − an edge falloff that forces a 4-tile water border.
3. Land is every tile at or above the value quantile that yields exactly `CONFIG.map.landFraction`.
4. Call `applyRelief`.

- [ ] **Step 1: Write the failing tests**
```ts
it('is deterministic', () => expect(generateRandomMap(5, 'small').terrain).toEqual(generateRandomMap(5, 'small').terrain));
it('differs by seed', () => expect(generateRandomMap(5, 'small').terrain).not.toEqual(generateRandomMap(6, 'small').terrain));
it('uses configured sizes', () => { const m = generateRandomMap(1, 'medium'); expect([m.width, m.height]).toEqual([800, 450]); });
it('has 35–45% land and a water border', () => { const m = generateRandomMap(1, 'small'); const f = m.landCount / (m.width * m.height);
  expect(f).toBeGreaterThan(0.35); expect(f).toBeLessThan(0.45);
  for (let x = 0; x < m.width; x++) { expect(m.terrain[tileOf(m, x, 0)]).toBe(Terrain.Water); expect(m.terrain[tileOf(m, x, m.height - 1)]).toBe(Terrain.Water); } });
it('contains plains, hills and mountains', () => { const t = new Set(generateRandomMap(2, 'small').terrain); expect([1, 2, 3].every(v => t.has(v))).toBe(true); });
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(map): seeded random continent generator`.

### Task 4: Real world map

**Files:**
- Create: `scripts/build-world-map.ts`, `src/sim/map/worldMap.ts`, `public/maps/world.bin` (generated, then committed)
- Test: `src/sim/map/worldMap.test.ts`

**Interfaces:**
- Produces: `WORLD_PROJECTION = { width: 1500, height: 567, latMax: 78, latMin: -58 }`. The height is round(1500 × 136 / 360).
- Produces: `lonLatToTile(lon: number, lat: number): TileIndex` (equirectangular).
- Produces: `decodeWorldMap(bytes: Uint8Array): GameMap`. It calls `decodeMap` and throws if the dimensions don't match the projection.
- Script:
  1. Load `world-atlas/land-50m.json` via `createRequire` and convert it with `feature(topology, topology.objects.land)`.
  2. For each row, take the latitude at the row centre and collect the longitude crossings of every ring edge across all polygons.
  3. Sort the crossings and fill tile centres between pairs (even-odd rule) as Plains.
  4. Run `applyRelief` with `new Rng(1337)`.
  5. Write `encodeMap` output to `public/maps/world.bin`.

- [ ] **Step 1:** Run `npm i -D -E world-atlas@2.0.2 topojson-client@3.1.0 @types/topojson-client@3.1.5`.
- [ ] **Step 2: Write the failing tests**
```ts
const map = decodeWorldMap(new Uint8Array(readFileSync('public/maps/world.bin')));
it('matches the projection', () => expect([map.width, map.height]).toEqual([1500, 567]));
it.each([[2.35, 48.85], [10, 23], [134, -25], [-100, 40], [78, 22], [-60, -10]])('land at %s,%s', (lon, lat) =>
  expect(map.terrain[lonLatToTile(lon, lat)]).not.toBe(Terrain.Water));
it.each([[-30, 30], [-150, 0], [0, 0], [70, -20], [160, 30]])('water at %s,%s', (lon, lat) =>
  expect(map.terrain[lonLatToTile(lon, lat)]).toBe(Terrain.Water));
it('land share is 25–45%', () => { const f = map.landCount / (map.width * map.height); expect(f).toBeGreaterThan(0.25); expect(f).toBeLessThan(0.45); });
it('file is under 300 KB', () => expect(statSync('public/maps/world.bin').size).toBeLessThan(300_000));
```
- [ ] **Step 3:** Run tests → FAIL, because the file is missing.
- [ ] **Step 4:** Implement the script and the loader, then run `npm run build:world`.
- [ ] **Step 5:** Run tests → PASS.
- [ ] **Step 6:** Commit `feat(map): rasterized real-world map asset`.

### Task 5: Water navigation

**Files:** Create `src/sim/map/waterNav.ts`. Test: `src/sim/map/waterNav.test.ts`.

**Interfaces:**
- Produces: `interface WaterNav { cellSize: number; cols: number; rows: number }`. Internally, each cell stores the water bodies present in it and one representative water tile per (cell, body).
- Produces: `buildWaterNav(map: GameMap, cellSize = CONFIG.map.navCellSize): WaterNav`.
- Produces: `findWaterPath(map, nav, from: TileIndex, to: TileIndex): TileIndex[] | null`.
  - `from` and `to` are water tiles. It returns `null` when they are in different water bodies.
  - Otherwise it runs A* over 8-connected cells that contain water of that body. The heuristic is octile distance.
  - The result is a list of waypoints: the representative tile of each cell, ending at `to`.
- Produces: `adjacentWater(map, land: TileIndex, body?: number): TileIndex | null`. It returns a water 4-neighbour, restricted to `body` when one is given.

- [ ] **Step 1: Write the failing tests**
```ts
const m = mapFromAscii([
  '..........', '.########.', '.#......#.', '.#.####.#.', '.#......#.', '.########.', '..........',
]); // outer ring of sea + an inner lake
const nav = buildWaterNav(m, 2);
it('null across different water bodies', () => expect(findWaterPath(m, nav, tileOf(m, 0, 0), tileOf(m, 3, 2))).toBeNull());
it('paths around land and ends at target', () => { const p = findWaterPath(m, nav, tileOf(m, 0, 0), tileOf(m, 9, 6))!;
  expect(p.at(-1)).toBe(tileOf(m, 9, 6)); for (const t of p) expect(m.terrain[t]).toBe(Terrain.Water); });
it('from === to', () => expect(findWaterPath(m, nav, 0, 0)).toEqual([0]));
it('adjacentWater finds a water neighbour', () => expect(m.terrain[adjacentWater(m, tileOf(m, 1, 1))!]).toBe(Terrain.Water));
it('world map: Atlantic → Indian Ocean path in < 50 ms', () => { /* lonLatToTile(-30,0) → (80,-20); time it */ });
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(map): coarse water navigation`. Push the branch.

---

## Milestone 2 — Core simulation

### Task 6: Game state, ownership, relations, command plumbing, fixtures

**Files:**
- Create: `src/shared/colors.ts`, `src/sim/core/nation.ts`, `src/sim/core/names.ts`, `src/sim/core/game.ts`, `src/sim/core/commands.ts`, `src/sim/systems/relations.ts`, `src/sim/testing/fixtures.ts`
- Test: `src/sim/core/game.test.ts`, `src/sim/systems/relations.test.ts`

**Interfaces:**
- Consumes: `GameMap`, `buildWaterNav`, `Rng`, the types.
- Produces (`nation.ts`):
```ts
interface Nation { id: NationId; name: string; color: number; isPlayer: boolean;
  difficulty: Difficulty | null; personality: Personality | null;
  alive: boolean; spawned: boolean; spawnTile: TileIndex; troops: number; gold: number; tiles: number;
  border: Set<TileIndex>;       // owned tiles with a 4-neighbour not owned by this nation (water counts; map edge doesn't)
  sumX: number; sumY: number;   // for centroid labels
  buildingCounts: Record<BuildingType, number>; // active buildings only
  stats: { peakTiles: number; tilesCaptured: number; buildingsBuilt: number; goldEarned: number } }
```
- Produces (`game.ts`):
```ts
interface GameSetup { map: GameMap; seed: number; player: { name: string } | null;
  bots: { difficulty: Difficulty; personality?: Personality }[]; spawnTicks?: number; debug?: boolean }
class Game {
  constructor(setup: GameSetup)  // player = nation 1 when present; bots follow; nations[0] is the "unowned" placeholder
  readonly map: GameMap; readonly nav: WaterNav; readonly rng: Rng; readonly debug: boolean;
  tick: number; phase: Phase; result: GameResult | null; spawnEndsAt: number; spawnSpacing: number;
  owner: Uint16Array; nations: Nation[]; playerId: NationId; relations: Relations;
  nextId(): number; queue(cmd: Command): void;
  step(): void;                                   // this task: apply queued commands (in order), tick++
  setOwner(tile: TileIndex, to: NationId): void;  // see below
  onOwnerChange: ((tile: TileIndex, from: NationId, to: NationId) => void)[]; // hooks for later systems
  emit(e: GameEvent): void; drainEvents(): GameEvent[]; drainChangedTiles(): TileIndex[];
  alive(): Nation[];
}
```
  `setOwner` updates `owner`, the `tiles` counts, the border sets of the old and new owner for the tile and its 4 neighbours, `sumX`/`sumY`, `peakTiles` and the changed-tile list, and then calls the `onOwnerChange` hooks.
- Produces (`commands.ts`):
  - `type CommandResult = { ok: true } | { ok: false; reason: string }`
  - `applyCommand(game: Game, cmd: Command): CommandResult`
    - It is one `switch` on `cmd.type`, and later tasks add cases to it.
    - It rejects unknown nation ids, dead nations, and commands that are wrong for the current phase. `debugGrant` is rejected unless `game.debug` is set.
    - Every rejection emits exactly one `{ type: 'rejected' }` event.
- Produces (`relations.ts`):
  - `class Relations { constructor(nationCount: number); get(a, b): Relation; set(a, b, r): void; embargoed(a, b): boolean /* either direction */; setEmbargo(from, to, on): void; trust(from, to): number /* default 0.5 */; setTrust(from, to, v): void; warsOf(a): NationId[] }`
  - `declareWar(game, a, b): void`. It does nothing for id 0, for a nation and itself, or for a pair already at war. It throws if the pair is allied, because callers validate first. It emits a `relation` event.
  - `canTrade(game, a, b): boolean`, which is true when the pair isn't at war and neither side has an embargo.
- Produces: `nationNames(rng: Rng, count: number): string[]`, which returns unique invented names built from syllables.
- Produces: `nationColor(index: number, isPlayer: boolean): number`. The player is always `0x3b82f6`; bots get golden-angle hues at fixed saturation and lightness.
- Produces: `makeTestGame(opts: { map: string[]; owners?: string[]; nations: Partial<Nation>[]; seed?: number; debug?: boolean; difficulties?: Difficulty[] }): Game`. In the owners grid, `a`–`z` map to nation ids 1–26 and `.` means unowned. `nations[i]` overrides fields on nation i+1. The phase is `'playing'` and there is no player.

- [ ] **Step 1: Write the failing tests**
```ts
it('player is nation 1, bots follow', () => { const g = new Game({ map: mapFromAscii(['####']), seed: 1, player: { name: 'You' },
  bots: [{ difficulty: 'easy' }, { difficulty: 'hard' }] }); expect(g.playerId).toBe(1); expect(g.nations).toHaveLength(4); expect(g.nations[3].difficulty).toBe('hard'); });
it('setOwner maintains counts, borders and changed tiles', () => { const g = makeTestGame({ map: ['#####'], owners: ['aab..'], nations: [{}, {}] });
  expect(g.nations[1].tiles).toBe(2); expect([...g.nations[1].border]).toEqual([1]);
  g.setOwner(2, 1); expect(g.nations[2].tiles).toBe(0); expect([...g.nations[1].border]).toEqual([2]); expect(g.drainChangedTiles()).toContain(2); });
it('rejects commands from unknown or dead nations with one event', () => { const g = makeTestGame({ map: ['##'], owners: ['a.'], nations: [{}, { alive: false }] });
  expect(applyCommand(g, { type: 'debugGrant', nation: 9, gold: 1 }).ok).toBe(false);
  expect(applyCommand(g, { type: 'debugGrant', nation: 2, gold: 1 }).ok).toBe(false);
  expect(g.drainEvents().filter(e => e.type === 'rejected')).toHaveLength(2); });
it('debugGrant only works in debug games', ...);
it('names are unique', () => expect(new Set(nationNames(new Rng(1), 40)).size).toBe(40));
it('declareWar is symmetric and emits once', ...);
it('embargo in either direction blocks canTrade', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): game state, ownership, relations and command plumbing`.

### Task 7: Spawn phase

**Files:** Create `src/sim/systems/spawn.ts`. Modify `commands.ts` (the `spawn` case) and `game.ts` (the phase logic in `step` and the `spawnSpacing` calculation). Test: `src/sim/systems/spawn.test.ts`.

**Interfaces:**
- Produces: `spawnNation(game, nation, tile): CommandResult`.
  - It is valid only in phase `'spawn'`, on unowned land, at distance ≥ `game.spawnSpacing` from every other spawn.
  - Re-spawning moves your start: release the previous disk first.
  - It claims unowned land within `CONFIG.spawn.radius` (dx²+dy² ≤ r²), sets troops and gold to the start values, and emits `spawned`.
- `game.spawnSpacing = clamp(min(CONFIG.spawn.minDistance, sqrt(landCount / (nationCount * 4))), minDistanceFloor, ∞)`.
- Produces: `randomSpawnTile(game, rng, spacing = game.spawnSpacing): TileIndex | null`. It samples up to 2,000 land tiles. If none qualify, it retries with the spacing multiplied by 0.75 until it reaches `minDistanceFloor`, and finally accepts any unowned land.
- Produces: `endSpawnPhase(game): void`. It random-spawns every unspawned nation, sets the phase to `'playing'` and emits `phase`. `step()` calls it when `tick >= spawnEndsAt`, where `spawnEndsAt = setup.spawnTicks ?? CONFIG.spawn.phaseTicks`.

- [ ] **Step 1: Write the failing tests**
```ts
it('claims a radius-4 disk (49 tiles on open plains)', ...);
it('rejects water, owned and too-close spawns with a reason', ...);
it('player can move their spawn during the phase', ...);
it('auto-spawns everyone and switches to playing', ...);
it('spawns all 41 nations on a small random map', () => { const g = new Game({ map: generateRandomMap(3, 'small'), seed: 3,
  player: { name: 'P' }, bots: Array.from({ length: 40 }, () => ({ difficulty: 'easy' as const })), spawnTicks: 1 });
  g.step(); g.step(); expect(g.alive().filter(n => n.spawned)).toHaveLength(41); });  // Review Focus 2
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): spawn phase`.

### Task 8: Combat and attacks

**Files:** Create `src/sim/systems/combat.ts` and `src/sim/systems/attacks.ts`. Modify `commands.ts` (the `attack` case) and `game.ts` (add `attacks: Attack[]` and call `stepAttacks` in `step`). Test: `combat.test.ts`, `attacks.test.ts`.

**Interfaces (`combat.ts`):**
- `density(n: Nation): number` returns troops ÷ max(1, tiles).
- `defenseMultiplier(game, tile): number` returns 1 for now; Task 10 fills it in.
- `tileCaptureCost(game, attacker, tile): number`, where t = `CONFIG.combat.terrainCost[terrain]`:
  - unowned: t × `neutralCost`
  - owned: t × (`baseCost` + density(owner) × `densityFactor`) × defenseMultiplier
- `defenderLossPerTile(game, tile): number` returns density(owner) × `defenderLossFactor`.
- `estimateConquest(game, attacker, target, troops): { tiles: number; attackerLoss: number; defenderLoss: number }`. It is pure:
  1. Sample up to 64 frontier tiles and take their average cost c.
  2. tiles = min(floor(troops / c), target.tiles, or for neutral land the unowned tiles of the attacker's landmass).
  3. Derive both losses from that.

**Interfaces (`attacks.ts`):**
- `interface Attack { id: number; attacker: NationId; target: NationId /* 0 = unowned land */; troops: number; frontier: MaxHeap }`
- `sharesBorder(game, a, b): boolean` checks the 4-neighbours of `a.border`. With b = 0 it means "touches unowned land".
- `startAttack(game, attacker, target, troops, seedTile?: TileIndex): CommandResult`
  - **Rejects:** a nation targeting itself, an allied target, a target with no shared border and no seed tile, and fewer than 1 troop.
  - **Existing attack:** merges into an existing attacker→target attack.
  - **Counterattack:** first cancels against any target→attacker attack, with both sides losing the smaller troop count.
  - **Effects:** subtracts troops from the pool, calls `declareWar` for a nation target, and emits `attackStarted`.
- `attackCommand(game, cmd)`
  - The target is the owner of `cmd.tile`. The ratio is clamped to [0.01, 1] and troops = floor(nation.troops × ratio).
  - **Rejects:** off-map tiles, water, and the attacker's own tile.
  - When the target isn't adjacent and `allowBoat` is set, it delegates to `launchBoat` (Task 18). Until then it rejects with "not adjacent".
- `landTroops(game, nation, tile, troops): void`
  - On the nation's own tile or an ally's tile, the troops return to the pool.
  - Otherwise it pays the tile's capture cost. If the troops can't cover it, they are lost.
  - It then calls setOwner, emits `landed` and runs `startAttack(nation, previousOwner, rest, tile)`.
- `stepAttacks(game): void`
  1. budget = clamp(frontier.size × `frontFraction`, `minTilesPerTick`, `maxTilesPerTick`) speed points.
  2. Pop tiles. Skip stale ones, meaning the owner is no longer the target or no attacker tile touches it.
  3. Each tile uses up its terrain cost in speed points. If the attack's troops are below the tile's capture cost, the attack ends and the remainder returns to the attacker.
  4. Otherwise the defender loses min(troops, defenderLossPerTile), the tile changes owner, and the tile's neighbours that belong to the target are pushed with priority = (attacker-owned 4-neighbours) + rng.next() × 0.5.
  5. The initial frontier is the target tiles touching `attacker.border`, plus the neighbours of the seed tile.
  6. An attack ends when its frontier is empty or when the attacker or target dies.
  7. A target reaching 0 tiles is eliminated: `alive = false`, its attacks are dropped and their troops lost, and `eliminated` is emitted.
- `cancelAttacksBetween(game, a, b): void` returns the troops of both directions to their attackers.

- [ ] **Step 1: Write the failing tests**
```ts
it('neutral cost scales with terrain', () => { /* plains vs mountains ratio = 2.5 */ });
it('owned tile cost grows with defender density', ...);
it('expands into neutral land and finishes', () => { const g = makeTestGame({ map: ['##########'], owners: ['a.........'], nations: [{ troops: 1000 }] });
  expect(applyCommand(g, { type: 'attack', nation: 1, tile: 5, ratio: 0.5 }).ok).toBe(true);
  for (let i = 0; i < 50; i++) g.step(); expect(g.nations[1].tiles).toBe(10); expect(g.attacks).toHaveLength(0); expect(g.nations[1].troops).toBeLessThan(1000); });
it('stops when troops run out and returns the remainder', ...);
it('defender loses troops per tile and is eliminated at 0 tiles', ...);
it('opposing attacks cancel out', ...);
it('mountains are crossed more slowly than plains', ...);
it('rejects own tile, water, off-map and non-adjacent targets with one event each', ...);  // Review Focus 1
it('estimateConquest is within 20% of a real run', ...);
it('attacking a nation declares war; attacking an ally is rejected', ...);
it('landTroops on own tile returns troops; on enemy coast starts an attack', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): combat model and frontier attacks`.

### Task 9: Economy, victory, step order

**Files:** Create `src/sim/systems/economy.ts` and `src/sim/systems/victory.ts`. Modify `game.ts` (the final `step` order). Test: `economy.test.ts`, `victory.test.ts`.

**Interfaces:**
- `maxTroops(game, n): number` = `baseMax` + `perTile` × tiles. Task 10 adds cities.
- `troopGrowth(game, n): number`
  - Normally (`baseGrowth` + `growthRate` × troops × (1 − troops/max)) × barracksFactor, where barracksFactor is 1 until Task 10.
  - When troops > max it is −`overMaxDecay` × (troops − max).
- `goldIncome(game, n): number` = `gold.base` + `gold.perTile` × tiles. Task 10 adds buildings.
- `stepEconomy(game): void` runs only in `'playing'`. It applies growth and income and adds to `stats.goldEarned`.
- `checkVictory(game): GameResult | null` returns the first match of:
  1. a nation with tiles ≥ `win.landShare` × landCount
  2. exactly one nation alive
  3. more than one alive, all mutually allied → `alliance`
- `Game.step()` order (final; later tasks plug into the marked slots):
  1. Apply queued commands.
  2. In the spawn phase: tick++, call `endSpawnPhase` when due, and return.
  3. `stepBuildings` (Task 10)
  4. `stepEconomy`
  5. `stepAttacks`
  6. `stepUnits` (Task 18)
  7. `stepDiplomacy` (Task 24)
  8. `checkVictory`. On a result: set `result`, set phase `'ended'` and emit `gameOver`.
  9. tick++

  Once the phase is `'ended'`, `step()` does nothing.

- [ ] **Step 1: Write the failing tests**
```ts
it('growth peaks near half of max', () => { /* growth(0.5·max) > growth(0.1·max) and > growth(0.95·max) */ });
it('troops above max decay toward max', ...);
it('gold income grows with land', ...);
it('80% land share wins', ...);
it('last nation standing wins', ...);
it('eliminated player: commands rejected, sim continues to a result', ...);  // Review Focus 3
it('step is a no-op after the game ends', ...);
it('same seed + same commands ⇒ identical owner arrays after 300 ticks', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): economy, victory and tick order`.

---

## Milestone 3 — Buildings

### Task 10: Buildings

**Files:** Create `src/sim/systems/buildings.ts`. Modify `combat.ts` (`defenseMultiplier`), `economy.ts` (building effects), `game.ts` (add `buildings: BuildingStore` and register an `onOwnerChange` hook) and `commands.ts` (`build`). Test: `buildings.test.ts`.

**Interfaces:**
- `interface Building { id: number; type: BuildingType; owner: NationId; tile: TileIndex; ticksLeft: number /* 0 = active */; cooldown: number }`
- `class BuildingStore { byId: Map<number, Building>; at(tile): Building | undefined; ofNation(id, type?): Building[]; add(b): void; remove(id): void; transfer(id, to): void }`
- `buildingCost(game, nation, type): number` = `CONFIG.buildings[type].cost` × (1 + `costGrowth` × the number of that type the nation owns, counting ones under construction).
- `canPlace(game, nation, type, tile): CommandResult` requires all of these, each with its own reason:
  - the tile is the nation's own land
  - no building within `minSpacing` (Chebyshev distance)
  - port and naval base: a `map.coastal` tile
  - gold ≥ cost
- `build(game, cmd): CommandResult` pays and adds the building with `ticksLeft = buildTicks`.
- `stepBuildings(game): void` counts down. At 0 the building becomes active: `buildingCounts[type]++`, `stats.buildingsBuilt++`, and `buildingDone` is emitted.
- `onTileCaptured(game, tile, from, to): void` transfers any building on the tile, moving active counts too, and emits `buildingCaptured`.
- `destroyBuilding(game, id, by): void` removes the building, decrements counts and emits `buildingDestroyed`.
- `buildingsInRadius(game, owner, types: BuildingType[], tile, radius): Building[]`
- `tradeMultiplier(game, n): number` = 1 + `bank.tradeBonus` × active banks. It lives in `economy.ts`.
- Effects of active buildings:
  - **Max troops:** + `city.maxTroops` per city.
  - **Troop growth:** × (1 + `barracks.growthBonus` × barracks).
  - **Gold:** + `factory.gold` × factories + `bank.gold` × banks.
  - **Defense:** `defenseMultiplier` is the maximum multiplier of the owner's active defense posts and fortresses within their radius. They don't stack; with none in range it is 1.

- [ ] **Step 1: Write the failing tests**
```ts
it('cost rises with each building of a type', ...);
it('rejects foreign, water, too-close, inland-port and unaffordable placements with distinct reasons', ...);  // Review Focus 1
it('activates after buildTicks and applies city, factory, barracks and bank effects', ...);
it('defense post raises capture cost inside its radius only', ...);
it('fortress and post covering the same tile use the max, not the product', ...);
it('captured buildings change owner and counts', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): buildings and their effects`. Push the branch.

---

## Milestone 4 — AI core

### Task 11: AI profiles, perception, Bot, Match

**Files:** Create `src/sim/ai/profile.ts`, `src/sim/ai/perception.ts`, `src/sim/ai/bot.ts` and `src/sim/match.ts`. Test: `perception.test.ts`, `match.test.ts`, `profile.test.ts`.

**Interfaces:**
```ts
interface DifficultyProfile { reactionTicks: number; noise: number; mistakeChance: number; troopBand: [number, number];
  reserveFactor: number; spawnSamples: number; buildQuality: number; lookahead: boolean; counterattack: boolean;
  combinedArms: boolean; naval: boolean; air: boolean; betrayal: boolean; gangUp: boolean }
const DIFFICULTY: Record<Difficulty, DifficultyProfile>;
interface PersonalityWeights { aggression: number; economy: number; defense: number; trade: number;
  opportunism: number; diplomacy: number; betrayal: number }
const PERSONALITY: Record<Personality, PersonalityWeights>;
interface NeighborInfo { id: NationId; sharedBorder: number; troops: number; tiles: number; density: number;
  relation: Relation; defense: number /* avg defenseMultiplier over ≤16 sampled shared-border tiles */;
  otherWars: number; attackingMe: number; buildings: number }
interface Perception { me: NationId; troops: number; maxTroops: number; troopRatio: number; gold: number; income: number;
  tiles: number; density: number; neutralBorder: number; neighbors: NeighborInfo[]; incoming: number; wars: NationId[];
  threat: number; leader: NationId; leaderShare: number; myShare: number; coastalTiles: number }
function perceive(game: Game, me: NationId): Perception;   // one pass over me.border neighbours + attacks list
interface BotMemory { lastBuildTick: number; pendingAttack: { target: NationId; tile: TileIndex; ratio: number; at: number } | null;
  lastProposalTick: number; betrayTarget: NationId | null; focusTarget: NationId | null; lastNavalThreatTick: number }
class Bot { constructor(game: Game, id: NationId, difficulty: Difficulty, personality: Personality, seed: number);
  readonly id: NationId; readonly profile: DifficultyProfile; readonly weights: PersonalityWeights; readonly rng: Rng;
  memory: BotMemory; think(): Command[] /* returns [] in this task; later tasks compose modules */ }
class Match { constructor(setup: GameSetup); readonly game: Game; readonly bots: Bot[];
  step(): void;   // for each alive bot with (tick + id*7) % reactionTicks === 0: queue its think() commands; then game.step()
  queuePlayer(cmd: Command): void /* overwrites cmd.nation with playerId */ }
```
When a bot has no personality set, `Match` assigns one with `game.rng.pick`.

| profile | easy | normal | hard | insane |
|---|---|---|---|---|
| reactionTicks | 30 | 15 | 8 | 4 |
| noise / mistakeChance | 0.5 / 0.25 | 0.25 / 0.1 | 0.1 / 0.03 | 0 / 0 |
| troopBand | [0.75, 0.95] | [0.5, 0.8] | [0.4, 0.65] | [0.35, 0.6] |
| reserveFactor | 0 | 0.3 | 0.5 | 0.6 |
| spawnSamples / buildQuality | 1 / 0.3 | 50 / 0.7 | 300 / 0.9 | 800 / 1 |
| lookahead | ✗ | ✗ | ✗ | ✓ |
| counterattack | ✗ | ✓ | ✓ | ✓ |
| combinedArms | ✗ | ✗ | ✓ | ✓ |
| naval | ✓ | ✓ | ✓ | ✓ |
| air | ✗ | ✓ | ✓ | ✓ |
| betrayal | ✗ | ✗ | ✓ | ✓ |
| gangUp | ✗ | ✗ | ✓ | ✓ |

| personality | aggr | econ | def | trade | opp | dipl | betray |
|---|---|---|---|---|---|---|---|
| aggressive | 1.4 | 0.8 | 0.8 | 0.6 | 1.0 | 0.6 | 0.6 |
| builder | 0.8 | 1.4 | 1.2 | 1.0 | 0.8 | 1.0 | 0.2 |
| trader | 0.9 | 1.1 | 1.0 | 1.5 | 0.9 | 1.2 | 0.3 |
| opportunist | 1.1 | 1.0 | 0.9 | 0.9 | 1.5 | 0.8 | 0.8 |
| diplomat | 0.9 | 1.0 | 1.0 | 1.1 | 0.9 | 1.5 | 0.1 |

- [ ] **Step 1: Write the failing tests**
```ts
it('perceives neighbours, shared border and neutral border', () => { const g = makeTestGame({ map: ['######'], owners: ['aabb..'], nations: [{ troops: 100 }, { troops: 300 }] });
  expect(perceive(g, 1).neighbors).toEqual([expect.objectContaining({ id: 2, sharedBorder: 1, troops: 300 })]); expect(perceive(g, 2).neutralBorder).toBe(1); });
it('reports incoming attack troops and wars', ...);
it('finds the leader and its share', ...);
it('Match runs bots on their reaction cadence', () => { /* count think() calls over 120 ticks: easy 4, insane 30 */ });
it('Match.queuePlayer forces the player nation', ...);
it('harder difficulties react faster with less noise and fewer mistakes', () => { /* monotonic over easy→insane */ });
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(ai): profiles, perception, bot and match`.

### Task 12: AI military

**Files:** Create `src/sim/ai/military.ts`. Modify `bot.ts`. Test: `military.test.ts`.

**Interfaces:**
- `interface TargetScore { target: NationId /* 0 = neutral land */; score: number; troops: number }`
- `reserveNeeded(p, profile): number` = 1.2 × incoming + `reserveFactor` × the largest troop count among war neighbours. A neutral-relation neighbour with more troops than me counts at 0.3×.
- `attackBudget(p, profile): number`
  - If troopRatio > band[1]: troops − max(band[0] × maxTroops, reserve).
  - Else, with neutralBorder > 0: (troops − reserve) × 0.5.
  - Otherwise 0.
  - Never below 0.
- `scoreTargets(game, p, bot): TargetScore[]` returns scores sorted descending (formula below).
- `chooseAttack(game, p, bot): Command | null` returns an `attack` command. Its tile is any target tile touching my border, and its ratio is budget ÷ troops. With probability `mistakeChance` it takes the 2nd-best target instead.

Scoring. Candidates are neutral land (when neutralBorder > 0) and every non-allied neighbour; an ally qualifies only when it is `memory.betrayTarget`.
```
est   = estimateConquest(game, me, id, budget)
gain  = est.tiles + buildingTileValue * n.buildings * est.tiles / max(1, n.tiles)
score = gain / max(1, est.attackerLoss) * aggression * (1 + opportunism * ((n.otherWars>0 ? .5 : 0) + (n.density < p.density ? .3 : 0)))
neutral: score = est.tiles / max(1, est.attackerLoss) * neutralBias
if relation !== 'war' && p.wars.length > 0: score *= secondFrontPenalty
if profile.gangUp && id === p.leader && p.leaderShare > gangUpShare: score *= 2
if memory.focusTarget === id: score *= 1.5
if profile.lookahead: for each war neighbour w ≠ id: score -= estimateConquest(w → me with my troops − budget).tiles / max(1, p.tiles) * counterRiskWeight
score *= 1 + noise * (rng.next() * 2 − 1);  drop candidates with score < minAttackScore
```
Counterattack (`profile.counterattack`): when a neighbour has `attackingMe > 0` and I can send 1.1 × attackingMe after the reserve, attack that neighbour with exactly that many troops, ahead of the normal scoring.

- [ ] **Step 1: Write the failing tests** (small `makeTestGame` scenarios with `new Bot(...)`)
```ts
it('expands into neutral land when available', ...);
it('picks the weaker of two neighbours', ...);
it('waits while troops are below the band and nothing is free', ...);
it('keeps the reserve when under attack', () => { /* cmd.ratio * troops <= troops - reserveNeeded(p, profile) */ });
it('counterattacks an incoming attack (normal+) but not on easy', ...);
it('never targets an ally', ...);
it('avoids opening a second front when an equal option exists', ...);
it('hard bot gangs up on the leader over a slightly weaker non-leader', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement, and have `think()` call `chooseAttack`. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(ai): target scoring, sizing, timing and counterattacks`.

### Task 13: AI spawn and economy planner

**Files:** Create `src/sim/ai/spawn.ts` and `src/sim/ai/economy.ts`. Modify `match.ts` (at tick 0 of the spawn phase each bot queues `spawn`) and `bot.ts`. Test: `spawn.test.ts`, `economyAi.test.ts`.

**Interfaces:**
- `chooseSpawn(game, me, profile, rng): TileIndex | null`
  - It takes `profile.spawnSamples` valid tiles.
  - score = min(1, landmassSize/2000) × 2 + min(1, distance to the nearest spawn ÷ (spacing × 3)) + 0.5 × the plains share within radius 6.
  - Easy simply takes the first valid random tile.
- `troopGoldValue(p): number` = p.income ÷ max(1, current growth). It is the exchange rate for troops versus gold, and Task 26 reuses it.
- `rankBuilds(game, p, bot): { type: BuildingType; value: number }[]`. Each value is benefit per gold × personality weight:
  - **factory:** gold ÷ cost × economy
  - **bank:** (gold + tradeIncomePerTick × tradeBonus) ÷ cost × trade
  - **city:** maxTroops × troopGoldValue ÷ cost × economy
  - **barracks:** growth × bonus × troopGoldValue × 600 ÷ cost × economy
  - **defensePost / fortress:** frontThreat × multiplier ÷ cost × defense, where frontThreat = max over war neighbours, and over neutral neighbours with troops > 1.5× mine, of their troops ÷ mine. It is 0 when there's no threat.
  - **port:** when I have coastal tiles and other nations have ports in a water body I touch: (goldBase + 100 × goldPerTile) ÷ tradeEveryTicks × trade ÷ cost
  - **navalBase / airport / antiAir / radar:** 0. Tasks 20 and 23 add these.
- `findPlacement(game, me, type, p, rng): TileIndex | null`. Every candidate must pass `canPlace`. The intent depends on the type:
  - **interior** (city, factory, barracks, bank, airport, radar): of 60 sampled own tiles, take the one that maximises the minimum distance to a 200-tile sample of my border tiles that touch another nation.
  - **front** (defensePost, fortress):
    1. Pick the most threatened neighbour and sample my border tiles that touch it.
    2. Move each sample 3 tiles toward my centroid.
    3. Choose the candidate whose radius covers the most of those border tiles.
  - **coast** (port, navalBase): my coastal tiles, preferring the largest water body.
- `chooseBuild(game, p, bot): Command | null`
  - It returns the best plan if it is affordable now.
  - If the best plan isn't affordable but will be within `saveHorizonTicks`, it returns null and saves.
  - With probability (1 − buildQuality) it picks a random affordable type instead.

- [ ] **Step 1: Write the failing tests**
```ts
it('insane spawns on a big continent rather than a tiny island', ...);
it('spawn respects spacing', ...);
it('builds economy first with no threats', () => expect(['factory', 'city', 'bank', 'barracks']).toContain(type));
it('builds a defense facing a strong hostile neighbour, within 10 tiles of that border', ...);
it('places cities away from foreign borders', ...);
it('places ports only on coastal tiles', ...);
it('saves for a better building instead of buying a worse one', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement, with `think()` calling `chooseBuild` before `chooseAttack`. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(ai): spawn choice and economy planner`.

### Task 14: AI arena

**Files:** Create `src/sim/arena.ts` and `scripts/arena.ts`. Test: `src/sim/arena.test.ts`.

**Interfaces:**
- `interface ArenaSpec { seed: number; size: MapSize; teams: { difficulty: Difficulty; count: number }[]; maxTicks: number }`
- `interface ArenaResult { winner: Difficulty | null; ranking: { id: NationId; difficulty: Difficulty; tiles: number }[]; ticks: number; timeAtMaxShare: Record<Difficulty, number> }`. `timeAtMaxShare` is the share of ticks a bot spent at a troopRatio above 0.95.
- `runMatch(spec): ArenaResult` runs a `Match` with `player: null` and `spawnTicks: 1` until a result or `maxTicks`. The winner is the result's difficulty, or else the difficulty of the nation with the most tiles.
- `headToHead(a, b, seeds: number[], size: MapSize, perTeam = 4, maxTicks = 6000): { aWins: number; bWins: number; draws: number; rateA: number }`
- **CLI:** `npm run arena -- --seeds 20 --size small` plays insane-vs-hard, hard-vs-normal and normal-vs-easy, prints a table, and exits 1 if any rate is below 0.7.

- [ ] **Step 1: Write the failing tests**
```ts
it('runMatch finishes and ranks every bot', () => { const r = runMatch({ seed: 1, size: 'small',
  teams: [{ difficulty: 'easy', count: 2 }, { difficulty: 'insane', count: 2 }], maxTicks: 1500 }); expect(r.ranking).toHaveLength(4); });
it('insane beats easy in ≥ 3 of 4 seeds', () => expect(headToHead('insane', 'easy', [1, 2, 3, 4], 'small', 2, 3000).aWins).toBeGreaterThanOrEqual(3), 180_000);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Run `npm run arena -- --seeds 6 --size small` and note the baseline rates in the commit body. The full ≥70% gate is enforced in Task 29.
- [ ] **Step 6:** Commit `feat(ai): headless arena`. Push the branch.

---

## Milestone 5 — Client

### Task 15: Snapshot, worker protocol, tick scheduler

**Files:** Create `src/sim/snapshot.ts`, `src/worker/protocol.ts`, `src/worker/scheduler.ts`, `src/worker/sim.worker.ts` and `src/client/bridge.ts`. Test: `snapshot.test.ts`, `scheduler.test.ts`.

**Interfaces:**
```ts
// protocol.ts
interface StartOptions { map: MapChoice; bots: number; difficulty: Difficulty; seed: number; playerName: string; debug: boolean }
type ToWorker = { type: 'start'; options: StartOptions; worldMap?: ArrayBuffer } | { type: 'command'; command: Command } | { type: 'speed'; speed: 0 | 1 | 2 | 4 };
type FromWorker = { type: 'init'; init: InitPayload } | { type: 'update'; update: GameUpdate } | { type: 'error'; message: string };
interface InitPayload { width: number; height: number; terrain: Uint8Array; playerId: NationId;
  nations: { id: NationId; name: string; color: number; isPlayer: boolean }[]; spawnEndsAt: number }
interface NationSnap { id: NationId; troops: number; maxTroops: number; gold: number; income: number; tiles: number; alive: boolean;
  spawned: boolean; relationToPlayer: Relation; embargoed: boolean; attackingPlayer: number; label: { x: number; y: number; size: number } | null;
  stats: Nation['stats'] }
interface BuildingSnap { id: number; type: BuildingType; owner: NationId; tile: TileIndex; underConstruction: boolean }
interface UnitSnap { id: number; type: UnitType; owner: NationId; x: number; y: number; troops: number }
interface GameUpdate { tick: number; phase: Phase; changedTiles: Uint32Array; changedOwners: Uint16Array; nations: NationSnap[];
  buildings: BuildingSnap[] | null /* null = unchanged since last update */; units: UnitSnap[]; events: GameEvent[];
  requests: DiplomacyRequest[] /* pending, addressed to the player */; result: GameResult | null }
// snapshot.ts
function buildInit(match: Match): InitPayload;
function buildUpdate(match: Match): GameUpdate;
// scheduler.ts
class TickScheduler { constructor(tickMs: number, maxCatchUp: number); setSpeed(s: 0 | 1 | 2 | 4): void;
  due(nowMs: number): number /* ticks to run; at most maxCatchUp; excess backlog is dropped */ }
// bridge.ts (client)
class SimBridge { constructor(handlers: { onInit(i: InitPayload): void; onUpdate(u: GameUpdate): void; onError(m: string): void });
  start(options: StartOptions): Promise<void> /* fetches world.bin for map.kind === 'world' */; send(cmd: Command): void; setSpeed(s: 0 | 1 | 2 | 4): void }
```
- `buildUpdate` drains changed tiles and events. Every `CONFIG.client.labelEveryTicks` it recomputes labels: the centroid (sumX ÷ tiles, sumY ÷ tiles) if the nation owns that tile, else the nearest owned tile on a spiral search up to 30 tiles out. Label size = 0.6 × √tiles.
- Worker behaviour:
  - **`start`:** builds the map (`generateRandomMap` or `decodeWorldMap`) and the `Match`, then posts `init` with the terrain buffer transferred.
  - **Every 16 ms:** n = `scheduler.due(performance.now())`. If n > 0 it runs `match.step()` n times and posts an `update`, transferring its typed arrays.
- In the worker, use `const ctx = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null }`. This avoids mixing the DOM and WebWorker libs.

- [ ] **Step 1: Write the failing tests**
```ts
it('1 tick per 100 ms at 1×, 4 at 4×', ...);
it('paused runs zero ticks', () => { const s = new TickScheduler(100, 8); s.setSpeed(0); s.due(0); expect(s.due(5000)).toBe(0); });
it('caps catch-up after a long gap', () => { const s = new TickScheduler(100, 8); s.setSpeed(4); s.due(0);
  expect(s.due(60_000)).toBe(8); expect(s.due(60_100)).toBe(4); });  // Review Focus 5
it('buildUpdate reports each changed tile once', ...);
it('buildUpdate only includes requests addressed to the player', ...);
it('labels sit on an owned tile for C-shaped territory', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(worker): snapshots, protocol and tick scheduler`.

### Task 16: Client state, camera, formatting, territory layer, renderer

**Files:** Create `src/client/state.ts`, `src/client/camera.ts`, `src/client/format.ts`, `src/client/render/palette.ts`, `src/client/render/territoryLayer.ts`, `src/client/render/icons.ts` and `src/client/render/renderer.ts`. Test: `state.test.ts`, `camera.test.ts`, `format.test.ts`, `territoryLayer.test.ts`.

**Interfaces:**
```ts
class ClientState { init!: InitPayload; owner!: Uint16Array; tick: number; phase: Phase; nations: Map<NationId, NationSnap>;
  buildings: BuildingSnap[]; units: UnitSnap[]; feed: GameEvent[] /* last 50 player-relevant */; requests: DiplomacyRequest[];
  result: GameResult | null; get player(): NationSnap | undefined; get playerDefeated(): boolean;
  applyInit(i: InitPayload): void; applyUpdate(u: GameUpdate): void }
class Camera { x: number; y: number; zoom: number; constructor(viewW: number, viewH: number, mapW: number, mapH: number);
  resize(w: number, h: number): void; screenToTile(sx: number, sy: number): { x: number; y: number };
  tileToScreen(tx: number, ty: number): { x: number; y: number }; zoomAt(sx: number, sy: number, factor: number): void /* zoom ∈ [0.5, 32], point under cursor fixed */;
  pan(dx: number, dy: number): void; fitMap(): void }
function formatNumber(n: number): string;  // 999 → "999", 1234 → "1.2k", 2_500_000 → "2.5M"
const TERRAIN_COLORS: Record<Terrain, number>; function shade(color: number, f: number): number;
class TerritoryLayer { constructor(width: number, height: number, terrain: Uint8Array, colors: Map<NationId, number>);
  readonly pixels: Uint32Array; dirty: { x0: number; y0: number; x1: number; y1: number } | null;
  applyTiles(owner: Uint16Array, tiles: ArrayLike<number>): void }  // repaints each tile + 4 neighbours: owner colour, shade ×0.6 on border tiles, terrain colour if unowned
class Renderer { constructor(canvas: HTMLCanvasElement, state: ClientState, camera: Camera); draw(): void }
```
- Each frame, the `Renderer` does this:
  1. `putImageData` of the dirty rect onto an offscreen canvas.
  2. `drawImage` of that canvas with smoothing off, under the camera transform.
  3. Building icons (from `icons.ts`; under-construction buildings at 50% alpha), unit icons, and nation labels (hidden when they'd be under 8 px).
  4. During the spawn phase, a pulsing ring on each spawn.

- [ ] **Step 1: Write the failing tests**
```ts
it('camera screen↔tile round-trips', ...); it('zoomAt keeps the point under the cursor', ...); it('zoom is clamped', ...);
it.each([[999, '999'], [1234, '1.2k'], [2_500_000, '2.5M']])('formats %s', (n, s) => expect(formatNumber(n)).toBe(s));
it('applyUpdate writes owners and nation snaps', ...);
it('playerDefeated is true once the player is not alive', ...);  // Review Focus 3
it('territory layer shades borders and shows terrain for unowned land', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(client): state mirror, camera and territory rendering`.

### Task 17: Menu, HUD, input, panels, end screen; first browser test

**Files:**
- Create: `src/client/main.ts` (rewrite), `src/client/styles.css`, `src/client/input.ts`, `src/client/testApi.ts`, `playwright.config.ts`, `e2e/basic.spec.ts`
- Create under `src/client/ui/`: `dom.ts`, `menu.ts`, `hud.ts`, `leaderboard.ts`, `eventFeed.ts`, `speedControls.ts`, `endScreen.ts`

**Behaviour** (no hidden decisions):

**Menu**
- **Map:** World or Random. For Random, Size (small/medium/large) and Seed (defaults to a random number).
- **Bots:** a slider from 4 to 40, default 12.
- **Difficulty:** default Normal.
- **Your name.**
- **Play** calls `bridge.start`.

**URL parameters**
- `autostart=1` skips the menu, reading `map`, `size`, `seed`, `bots` and `difficulty` from the URL.
- `test=1` turns on `debug` and installs `window.__test`.

**HUD (bottom bar)**
- Shows troops / max, gold, and gold per second.
- Has the attack % slider, which defaults to 30%; `[` and `]` change it by 10%.
- Has 11 build buttons with live costs, disabled when unaffordable. Hotkeys `1`–`9` and `0` cover city…antiAir in `BUILDING_TYPES` order, and `-` is radar.

**Input (`class Controls`)**
- Modes: `default`, `{ build: BuildingType }` and `{ target: 'bomb' | 'paradrop' | 'boat' }`.
- **Left click:**
  - in the spawn phase: `spawn`
  - in `default` mode: `attack` with `allowBoat: true`
  - in build mode: `build`
  - in a target mode: that action
- **Mouse and keys:**
  - A left-drag over 5 px pans. The wheel zooms at the cursor. WASD and the arrow keys pan.
  - Space toggles pause. Esc returns to the default mode.

**Panels**
- **Leaderboard** (`.leaderboard-row` per row): the top 10 by tiles, plus the player's row. Each row shows name, land % and troops.
- **Speed controls:** ⏸, 1×, 2× and 4×.
- **Event feed:** the last 6 player-relevant events in plain English, e.g. "Varlonia attacked you", "City complete", "Your boat landed".

**End screen**
- Shows Victory, Defeat or Alliance victory, with stats: peak land %, tiles captured, buildings built and time played.
- "Keep watching" appears when the player is defeated but the game continues. "Main menu" is always there.

**Test API**
- `window.__test = { state, tileToScreen(tile), findLandTile(kind: 'unowned' | 'player' | 'enemy'), send(cmd) }`.
- `findLandTile('unowned')` prefers unowned land touching the player once the player has spawned.

**Playwright config**
- webServer: `npm run build && npx vite preview --port 4173 --strictPort`.
- baseURL `http://localhost:4173`, project `chromium`. `PLAYWRIGHT_BROWSERS_PATH` is already set.

- [ ] **Step 1:** Run `npm i -D -E @playwright/test@1.56.1`.
- [ ] **Step 2: Write the failing e2e test**
```ts
test('start, spawn, expand, no console errors', async ({ page }) => {
  const errors: string[] = []; page.on('console', m => m.type() === 'error' && errors.push(m.text())); page.on('pageerror', e => errors.push(e.message));
  await page.goto('/game/?autostart=1&test=1&map=random&size=small&seed=7&bots=4&difficulty=easy');
  await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
  const s = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!)); await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => window.__test.state.phase === 'playing', null, { timeout: 15_000 });
  const before = await page.evaluate(() => window.__test.state.player!.tiles);
  const t = await page.evaluate(() => window.__test.tileToScreen(window.__test.findLandTile('unowned')!)); await page.mouse.click(t.x, t.y);
  await expect.poll(() => page.evaluate(() => window.__test.state.player!.tiles), { timeout: 10_000 }).toBeGreaterThan(before);
  await expect(page.locator('.leaderboard-row')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/basic.png' }); expect(errors).toEqual([]);
});
```
- [ ] **Step 3:** Run `npx playwright test e2e/basic.spec.ts` → FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run it → PASS, then open `test-results/basic.png` and check the look: flat colours, readable HUD, labels.
- [ ] **Step 6:** Commit `feat(client): menu, HUD, controls, panels and end screen`. Push the branch.

---

## Milestone 6 — Sea

### Task 18: Units framework and troop boats

**Files:** Create `src/sim/systems/units.ts` and `src/sim/systems/naval.ts`. Modify `game.ts` (add `units: Map<number, Unit>` and call `stepUnits`), `attacks.ts` (the `allowBoat` path; elimination removes the nation's units) and `commands.ts` (`boat`). Test: `boats.test.ts`.

**Interfaces:**
```ts
interface Unit { id: number; type: UnitType; owner: NationId; x: number; y: number; hp: number; troops: number;
  path: TileIndex[]; pathIndex: number; targetTile: TileIndex; homeId: number | null; destId: number | null;
  patrol: TileIndex | null; cooldown: number; mission: 'outbound' | 'returning' | 'patrol'; warned: Set<NationId> }
function spawnUnit(game, init: Pick<Unit, 'type' | 'owner' | 'x' | 'y'> & Partial<Unit>): Unit;
function removeUnit(game, id: number, by: NationId /* 0 = no attacker */): void; // emits unitLost when by ≠ 0
function advanceAlongPath(u: Unit, map: GameMap, speed: number): boolean;      // true when the last waypoint is reached
function stepUnits(game): void;                                                // dispatch by type
function boatCap(game, n: Nation): number;   // troopBoat.baseCap + port.boatCapBonus * active ports
function launchBoat(game, nation, targetTile, troops): CommandResult;
function stepTroopBoat(game, u: Unit): void; // on arrival: landTroops(owner, targetTile, troops); remove
```
`launchBoat` works like this:
1. The target must be land, coastal, not the nation's own and not allied.
2. Take w = `adjacentWater(target)`.
3. The launch tile is the nation's coastal border tile, among those touching w's body, nearest the target.
4. Build the path with `findWaterPath`.
5. Troops come out of the pool, and boats out must stay below `boatCap`.

- [ ] **Step 1: Write the failing tests**
```ts
it('a boat crosses water, lands and starts an attack from the beach', ...);
it('rejects inland, own, allied, other-water-body and over-cap launches with reasons', ...);  // Review Focus 1
it('attack with allowBoat falls back to a boat when not adjacent', ...);
it('returns troops when the landing tile became the owner\'s own', ...);  // Review Focus 4
it('holds a disconnected island and attacks from both pieces', ...);
it('removes units of an eliminated nation', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): units and troop boats`.

### Task 19: Trade ships, naval base, warships

**Files:** Modify `naval.ts` and `commands.ts` (`buildUnit` warship, `moveUnit`). Test: `navalTrade.test.ts`.

**Interfaces:**
- `spawnTradeShips(game): void`
  - Applies to each active port whose `cooldown` reaches 0.
  - It picks a partner port where the owner differs, `canTrade` holds and the water body is the same. The pick is weighted toward a path length of 50–300 tiles.
  - It spawns a `tradeShip` with `homeId`/`destId` and resets the port's cooldown to `tradeEveryTicks`.
- `stepTradeShip(game, u): void`
  - **On arrival, if the destination port still exists with the same owner and `canTrade` still holds:** gold = goldBase + goldPerTile × path length. Each side gets gold × `tradeMultiplier(side)` and a `trade` event.
  - **Otherwise:** it despawns with no payout.
- `buildWarship(game, nation, navalBaseId): CommandResult`
  - The naval base must be the nation's own and active, and the nation pays `warship.cost`.
  - The warship spawns on adjacent water with `cooldown = buildTicks` and can't fight until that runs out.
- `moveWarship(game, nation, unitId, tile): CommandResult`. The tile must be water in the warship's body. It sets the `patrol` point.
- `stepWarship(game, u): void`
  - It moves toward its patrol point and wanders within `patrolRadius`.
  - Each tick it fires at the nearest ship within `range` whose owner is at war with it: `hitChance` for 1 damage.
  - At 0 hp the target is removed with `by = owner`. A sunk troop boat loses its troops.

- [ ] **Step 1: Write the failing tests**
```ts
it('trade ship pays both sides, with bank bonus', ...);
it('no trade ships between nations at war or under embargo', ...);
it('no payout when the destination port was captured mid-trip', ...);  // Review Focus 4
it('warship sinks an enemy troop boat (troops lost) and ignores neutral ships', ...);
it('moveWarship rejects land and other water bodies', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): trade ships and warships`.

### Task 20: AI naval play

**Files:** Create `src/sim/ai/naval.ts`. Modify `src/sim/ai/economy.ts` (port and navalBase values) and `bot.ts`. Test: `navalAi.test.ts`.

**Interfaces:**
- `chooseInvasion(game, p, bot): Command | null`
  - It runs when `neutralBorder === 0` and the best land `TargetScore` < `minAttackScore`, or when I'm boxed in by allies.
  - Candidates are nations, or unowned land, on other landmasses reachable through a water body that touches my coast. They are scored like land targets.
  - It returns a `boat` command to the candidate's coastal tile nearest my coast.
- `manageWarships(game, p, bot): Command[]`
  - **When I own a naval base and either an enemy boat has targeted me since `memory.lastNavalThreatTick` or my trade ships were sunk:** it returns a `buildUnit` warship command.
  - **For idle warships:** it returns `moveUnit` commands that intercept enemy boats heading for my coast.
- **Economy additions:**
  - navalBase value = (naval threat in the last 600 ticks ? 1 : 0) × defense ÷ cost.
  - Port value gets +0.5× when `chooseInvasion` has candidates.

- [ ] **Step 1: Write the failing tests**
```ts
it('uses boats when its continent is full', () => { /* bot owns its whole island; neutral island across water; within 5 thinks a 'boat' command appears */ });
it('does not use boats when cheap land is adjacent', ...);
it('builds a warship after being invaded by sea', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(ai): naval invasions and warships`. Push the branch.

---

## Milestone 7 — Air

### Task 21: Airports and planes

**Files:** Create `src/sim/systems/air.ts`. Modify `commands.ts` (`bomb`, `paradrop` and `buildUnit` fighter) and `units.ts` (dispatch). Test: `air.test.ts`.

**Interfaces:**
- `airportInRange(game, nation, tile): Building | null` returns the nearest active own airport with distance ≤ `airport.range` and cooldown 0.
- `launchBomber(game, nation, tile): CommandResult`
  - The target must be owned by another, non-allied nation. The nation pays `bomber.cost`.
  - The airport's cooldown becomes `bomber.cooldownTicks`. It calls `declareWar` and spawns a `bomber` flying straight.
- `launchParatroopers(game, nation, tile, ratio): CommandResult`
  - The target must be land that is neither the nation's own nor allied. The nation pays `paraPlane.cost`.
  - troops = min(ratio, `maxTroopsShare`) × troops. For a nation-owned target it calls `declareWar`.
- `buildFighter(game, nation, airportId): CommandResult`
- `spawnTradePlanes(game): void` works like trade ships, using airports, with no water-body restriction.
- `stepPlane(game, u): void`
  - **Bomber arrival:** it destroys the target owner's buildings within `bomber.radius`. The target owner loses density × (owned tiles in radius) × `killFactor` troops. Then it flies home and despawns on arrival, or despawns at once if its home airport is gone.
  - **Paratroopers arrival:** `landTroops`.
  - **Trade plane arrival:** pays out like trade ships, with the same validity checks.
  - **Fighter:**
    - **Patrol:** it orbits its airport within `fighter.range`.
    - **Combat:** it chases enemy planes (at war) within `detect` × radarBoost and gets a `hitChance` for 1 damage per tick within 2 tiles. Fighters dogfight each other.
    - **Losing its base:** it despawns if its airport is lost.

- [ ] **Step 1: Write the failing tests**
```ts
it('bomber destroys buildings, kills troops and declares war', ...);
it('rejects bomb/paradrop out of range, at own or allied tiles, or with no airport', ...);  // Review Focus 1
it('paratroopers land far behind the front and start an attack from there', ...);
it('trade planes pay both sides', ...);
it('a fighter shoots down an enemy bomber', ...);
it('a plane whose home airport was captured mid-mission despawns cleanly', ...);  // Review Focus 4
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): airports, bombers, paratroopers, fighters, trade planes`.

### Task 22: Anti-air and radar

**Files:** Modify `air.ts` (add `stepAntiAir` and `stepRadarWarnings`, called from `stepUnits`). Test: `airDefense.test.ts`.

**Interfaces:**
- `radarBoost(game, owner, x, y): number` returns `radar.boost` if any active radar of `owner` lies within `radar.radius`, else 1.
- `stepAntiAir(game): void`: for each active anti-air gun, every plane within `radius` whose owner is at war with the gun's owner has a `hitChance` × radarBoost chance of taking 1 damage. This includes trade planes.
- `stepRadarWarnings(game): void`: when an enemy bomber or para plane enters the radius of one of my radars, it emits `radarWarning` once per (unit, nation).

- [ ] **Step 1: Write the failing tests**
```ts
it('anti-air eventually downs a bomber flying through its radius', ...);
it('radar boosts anti-air (more kills across 20 seeds)', ...);
it('anti-air ignores planes of nations not at war', ...);
it('radar warning fires once per incoming bomber', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): anti-air guns and radar`.

### Task 23: AI air play

**Files:** Create `src/sim/ai/air.ts`. Modify `src/sim/ai/economy.ts` (airport, antiAir and radar values) and `bot.ts` (`pendingAttack` handling). Test: `airAi.test.ts`.

**Interfaces:**
- `planCombinedArms(game, p, bot, attack: Extract<Command, { type: 'attack' }>): Command[]`
  - It applies when `profile.combinedArms` is set, the target's front defense is above 1.2, and an airport is in range.
  - It returns a `bomb` on the strongest defense building within 25 tiles of my border with the target.
  - It sets `memory.pendingAttack = { target, tile, ratio, at: tick + flight ETA }`. `think()` issues the delayed attack once `tick ≥ at`.
- `chooseParadrop(game, p, bot): Command | null`
  - It applies during a war when the budget ≥ `minParaTroops`.
  - The target is the enemy's densest building cluster more than 15 tiles behind their front, within range.
- `manageAirDefense(game, p, bot): Command[]`: when a war enemy's airport covers my land and I own an airport, it returns `buildUnit` fighter (at most 1 fighter per 2 enemy airports).
- **Economy additions** (each × weight ÷ cost):
  - **Airport:** profile.air, and an enemy is within `airport.range` of my interior.
  - **Anti-air:** an enemy airport is in range of one of my building clusters.
  - **Radar:** I have ≥ 2 anti-air guns.
  - Placements: the airport as close to the front as possible while still 20+ tiles from the border; anti-air and radar at the centre of the nearest cluster.

- [ ] **Step 1: Write the failing tests**
```ts
it('hard bot bombs a front fortress before attacking, then attacks after the ETA', ...);
it('easy bot never uses planes', ...);
it('builds anti-air when an enemy airport is in range', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(ai): combined arms, paradrops and air defense`. Push the branch.

---

## Milestone 8 — Diplomacy

### Task 24: Alliances, peace, betrayal, embargo

**Files:** Create `src/sim/systems/diplomacy.ts`. Modify `game.ts` (add `requests: Map<number, DiplomacyRequest>` and call `stepDiplomacy`) and `commands.ts` (`proposeAlliance`, `breakAlliance`, `proposePeace`, `respond` and `embargo`). Test: `diplomacy.test.ts`.

**Interfaces:**
- `createRequest(game, kind, from, to, extra?: { deal?: Deal; target?: NationId }): CommandResult`
  - **Rejects:** self, dead nations and duplicate pending requests of the same kind.
  - It sets `expiresAt = tick + requestTtlTicks` and emits `request`.
  - **Alliance proposals:** need the pair not already allied. **Peace proposals:** need the pair at war.
- `respond(game, nation, requestId, accept): CommandResult`
  - Only the addressee can respond.
  - Accepting an alliance sets the relation to `allied` and calls `cancelAttacksBetween`. Accepting peace sets it to `neutral`.
  - It emits `requestResolved`.
- `breakAlliance(game, nation, other): CommandResult`
  - It moves the pair from `allied` to `neutral`.
  - Every third nation's trust in the betrayer drops by `betrayalTrustPenalty`, the victim's trust in the betrayer becomes 0, and `betrayal` is emitted.
- `setEmbargo(game, nation, other, on): CommandResult`
- `stepDiplomacy(game): void` expires requests (resolved as not accepted) and moves trust back toward 0.5 by `trustRecoveryPerTick`.

- [ ] **Step 1: Write the failing tests**
```ts
it('accepted alliance cancels attacks between the pair and blocks new ones', ...);
it('betrayal lowers every other nation\'s trust in the betrayer', ...);
it('peace ends a war', ...);
it('requests expire and only the addressee can respond', ...);
it('embargo stops new trade ships and planes', ...);
it('two allied survivors trigger alliance victory', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): alliances, peace, betrayal and embargo`.

### Task 25: Deals and joint attacks

**Files:** Modify `diplomacy.ts` and `commands.ts` (`proposeDeal`, `requestJointAttack`). Test: `deals.test.ts`.

**Interfaces:**
- `proposeDeal(game, from, to, deal): CommandResult`
  - **When proposing:** `from` must be able to afford its give side.
  - **On accept:** both sides are re-checked and the gold and troops change hands. If either side can't pay any more, nothing transfers and `requestResolved` carries `accepted: false`.
  - A gift is a deal whose get side is all zeros.
- `requestJointAttack(game, from, to, target): CommandResult`. The proposer and recipient must be allied, and the target must be allied to neither. When the player accepts, it is informational only.

- [ ] **Step 1: Write the failing tests**
```ts
it('accepted deal swaps gold and troops', ...);
it('deal fails if a side can no longer pay', ...);
it('gift transfers one way', ...);
it('joint attack requires an alliance and a non-allied target', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(sim): deals and joint attack requests`.

### Task 26: AI diplomacy

**Files:** Create `src/sim/ai/diplomacy.ts`. Modify `bot.ts`, which handles requests on every think and makes proposals at most every `proposalCooldownTicks`. Test: `diplomacyAi.test.ts`.

**Interfaces:**
- `evaluateRequest(game, p, bot, req): boolean`
  - **alliance:** accept when all of these hold:
    - the requester isn't the leader while `leaderShare > gangUpShare`
    - trust(me → them) ≥ 0.3
    - the requester isn't my top `scoreTargets` entry
    - the requester has ≥ 0.7× my troops, or my diplomacy weight is ≥ 1.2
  - **peace:** accept if estimateConquest(me → them).tiles < estimateConquest(them → me).tiles, or if I'm in another war.
  - **deal:** accept if value(get) − value(give) > 0, where gold is worth 1 and troops are worth `troopGoldValue` (×1.5 while at war).
  - **jointAttack:** accept if the target is a non-allied neighbour scoring ≥ 0.5× my best target. On accept, set `memory.focusTarget`.
- `proposeDiplomacy(game, p, bot): Command[]` (all respect the cooldown):
  - **Two fronts:** at war, with a strong non-allied neighbour → `proposeAlliance`.
  - **Losing:** incoming > 0.5 × troops → `proposePeace`.
  - **Gang-up:** `profile.gangUp`, leaderShare > `gangUpShare` and the leader isn't me → `proposeAlliance` to the strongest non-leader neighbour, then `requestJointAttack` against the leader to my allies.
  - **Trader:** at war with gold > 3 × income × 100 → `proposeDeal` to buy troops.
- `considerBetrayal(game, p, bot): NationId | null`
  - It requires `profile.betrayal` and a betrayal weight ≥ 0.5.
  - It returns the ally if the ally scores ≥ 2× the next-best target and its density < 0.6× mine.
  - `think()` then issues `breakAlliance` and sets `memory.betrayTarget`, and the attack comes on a later think.

- [ ] **Step 1: Write the failing tests**
```ts
it('accepts an alliance from a strong neighbour it is not targeting', ...);
it('refuses an alliance from the runaway leader', ...);
it('proposes an alliance to avoid a second front', ...);
it('accepts a profitable deal and rejects a bad one', ...);
it('never attacks an ally while allied', () => { /* 8 hard bots, 2000 ticks; spy applyCommand: zero 'rejected' events with reason 'allied' from bots */ });
it('only betrayal-enabled profiles betray', ...);
```
- [ ] **Step 2:** Run tests → FAIL. **Step 3:** Implement. **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(ai): alliances, deals, gang-ups and betrayal`.

### Task 27: Client sea, air and diplomacy UI; second browser test

**Files:**
- Create under `src/client/ui/`: `contextMenu.ts`, `diplomacyPanel.ts`, `requests.ts`
- Create under `src/client/render/`: `units.ts` (interpolated unit icons), `effects.ts` (bomb flashes, radar warning arrows)
- Modify: `input.ts`, `ui/eventFeed.ts`, `testApi.ts`
- Create: `e2e/features.spec.ts`

**Behaviour:**

**Right-click context menu**

| Item | When it appears |
|---|---|
| Attack | the tile isn't the player's own |
| Send boat | coastal land that isn't the player's own |
| Bomb, Paratroopers | always; greyed out with the reason when no airport is in range |
| Build ▸ | the player's own land |
| Build warship | the player's own naval base |
| Build fighter | the player's own airport |
| Move nearest warship here | water |
| Diplomacy with \<owner\> | the tile belongs to another nation |

**Diplomacy panel**
- Shows the relation badge, troops and tiles.
- Buttons: Propose alliance, Break alliance, Propose peace, Embargo on/off, and Gift.
- A trade deal form with four numbers: give gold, give troops, get gold, get troops.
- Ask to attack ▸, a target picker shown only for allies.

**Request popups** (top-right): Accept and Decline buttons with a countdown to expiry.

**Radar warning:** a red arrow at the screen edge pointing at the incoming plane, plus a feed line.

**Test API additions**
- `findLandTile` gains the kinds `'coastal-unowned' | 'player-interior' | 'player-coastal' | 'overseas-enemy'`.
- `grant({ gold, troops })` sends `debugGrant`.

- [ ] **Step 1: Write the failing e2e test**
```ts
test('build, boat, bomber, alliance', async ({ page }) => {
  // goto /game/?autostart=1&test=1&map=random&size=small&seed=11&bots=4&difficulty=easy; spawn on findLandTile('coastal-unowned'); wait for 'playing'
  // __test.grant({ gold: 1_000_000 })
  // press '1', click findLandTile('player-interior') → state.buildings has a city within 10 s
  // press '7' + click 'player-coastal' (port); press '9' + click 'player-interior' (airport); wait until both are active
  // right-click an enemy tile → click 'Bomb' → state.units contains a bomber
  // right-click findLandTile('overseas-enemy') → 'Send boat' → state.units contains a troopBoat
  // open diplomacy with a bot → 'Propose alliance' → feed contains a requestResolved for it within 5 s
  // screenshot test-results/features.png; expect no console errors
});
```
- [ ] **Step 2:** Run `npx playwright test e2e/features.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run both e2e specs → PASS, then review the screenshots.
- [ ] **Step 5:** Commit `feat(client): context menu, diplomacy panel, units and radar warnings`. Push the branch.

---

## Milestone 9 — Performance, AI tuning, deploy

### Task 28: Performance

**Files:** Create `scripts/perf.ts`. Optimise wherever profiling points.

- [ ] **Step 1:** Write `scripts/perf.ts`.
  - It runs the world map with `player: null`, 30 insane bots and `spawnTicks: 1`.
  - It warms up for 200 ticks, then times 3,000 `Match.step()` calls with `performance.now()`.
  - It prints the mean and p95, and exits 1 if the mean is ≥ 20 ms.
- [ ] **Step 2:** Run `npm run perf`. If it's over budget, profile with `npx tsx --cpu-prof scripts/perf.ts`. Typical fixes:
  - cache perception per think
  - reuse scratch arrays in border scans
  - cap `estimateConquest` samples
  - skip stale frontier pushes
- [ ] **Step 3:** Run `npm run perf` → exit 0 with mean < 20 ms. Then run `npm test` → PASS.
- [ ] **Step 4:** Commit `perf: meet 20 ms tick budget on world map with 30 insane bots`.

### Task 29: AI tuning to arena targets

**Files:** Modify `src/shared/config.ts`, `src/sim/ai/profile.ts` and the AI modules as needed. Create `docs/ai-arena-results.md`.

- [ ] **Step 1:** Run `npm run arena -- --seeds 20 --size small` and `npm run arena -- --seeds 10 --size medium`.
- [ ] **Step 2:** Tune only the AI values and AI decision code. Never give bots resource bonuses. Repeat until all three pairings reach ≥ 0.70 on both runs, and insane bots' `timeAtMaxShare` is < 10%.
- [ ] **Step 3:** Run `npm test` → PASS. The scenario tests must still hold.
- [ ] **Step 4:** Write the final win-rate table to `docs/ai-arena-results.md`.
- [ ] **Step 5:** Commit `tune(ai): reach arena win-rate targets`. Push the branch.

### Task 30: CI, GitHub Pages, README, final check

**Files:** Create `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`. Modify `README.md`.

**CI workflow** (`ci.yml`)
- Runs on push and pull_request.
- Steps: checkout@v4, setup-node@v4 (node 22, npm cache), `npm ci`, `npm run typecheck`, `npm test` and `npm run build`.

**Deploy workflow** (`deploy.yml`)
- Runs on push to `main` and on workflow_dispatch.
- Permissions: `pages: write` and `id-token: write`. Concurrency group: `pages`.
- Steps: `npm ci`, `npm test`, `npm run build`, configure-pages@v5, upload-pages-artifact@v3 (path `dist`) and deploy-pages@v4.

**README**
- How to play: the goal, plus a controls table for mouse, hotkeys, `[` `]`, Space and Esc.
- Dev commands: dev, test, e2e, arena, perf and build:world.
- How to turn on Pages: Settings → Pages → Source: GitHub Actions. The link is `https://oofguy3.github.io/game/`.

- [ ] **Step 1:** Write the workflows and the README.
- [ ] **Step 2:** Run the full check: `npm run typecheck && npm test && npm run build && npm run e2e && npm run perf && npm run arena -- --seeds 20 --size small`. Everything passes.
- [ ] **Step 3:** Take Playwright screenshots of the menu, the spawn phase, mid-game with buildings and units, the diplomacy panel and the end screen. Check them by eye.
- [ ] **Step 4:** Commit `ci: tests, build and GitHub Pages deploy`. Push the branch.
