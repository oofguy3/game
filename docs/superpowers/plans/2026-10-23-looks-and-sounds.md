# Borderline: New Look and Sound — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the game Borderline and give it a logo, a graphics-chip map (natural terrain, tinted-glass territories, glowing borders, shimmer, front lines), one shared panel style with animated screens, action and alert sounds with mute and volume, and a minimap — without changing how the game plays.

**Architecture:**
- A WebGL2 canvas under the existing 2D canvas draws only the map. Its data textures come from two pure, Node-tested modules: `terrainLook` (static) and `territoryField` (changing).
- The 2D canvas keeps drawing buildings, units, labels and effects, and falls back to today's flat picture whenever WebGL2 is missing or lost.
- Sounds are MP3 files: Kenney CC0 recordings, plus tones made in code at build time. A pure director decides which sounds an update makes, and a pure mixer applies the gaps, voice limit, volume and mute before a thin Web Audio output plays them.

**Tech Stack:**
- TypeScript 6.0.3, Vite 8.3.4, Vitest 5.0.3, Playwright 1.56.1.
- simplex-noise 4.0.3, already a dependency.
- WebGL2 and Web Audio, both built into the browser.
- `ffmpeg` and `unzip`, only for `scripts/build-sounds.ts`.

**Spec:** `docs/superpowers/specs/2026-10-23-looks-and-sounds-design.md`

## Global Constraints

**Branch and commits**
- Work on branch `claude/clever-cray-5279az` and commit after every task.
- Push at the end of each milestone with `git push -u origin claude/clever-cray-5279az`.
- Every commit message ends with the session's attribution trailer: the Co-Authored-By and Claude-Session lines.

**Game rules stay the same**
- The simulation's rules don't change.
- `src/sim/**` changes only in `snapshot.ts`.
- `src/sim/**` and `src/shared/**` never touch the DOM, `Math.random`, `Date` or `performance`.
- Arena results must be identical before and after: 90% / 95% / 100% on `--seeds 20 --size small`.

**Dependencies and determinism**
- No new npm dependencies.
- The terrain look is deterministic: it uses `Rng` from `src/sim/util/rng.ts` and `createNoise2D` from simplex-noise, seeded by `look.seed`.
- Cosmetic client code, such as the confetti, may use `Math.random`.

**Values fixed by the spec**

| Item | Value |
|---|---|
| Name | `GAME_NAME = 'Borderline'` |
| Logo colours | blue `#3b82f6`, red `#ef4444` |
| Coast distance | ±8 tiles (`COAST_RANGE = 8`) |
| Inner glow | 0–4 tiles (`EDGE_MAX = 4`) |
| Edge update blocks | 32×32 tiles |
| Water in the owner texture | `WATER_OWNER = 255` |
| Snow | latitude 58° (none) to 68° (full) |
| Dry bands | 15°–35° |
| Random map latitude | ±72° |
| Border line | 1.5 px |
| Capture shimmer | 1 s |
| Front pair table | 64×64 |

**Animation lengths**

| Animation | Length |
|---|---|
| Panel entry | 160 ms |
| Victory pop | 350 ms |
| Stat count-up | 800 ms |
| Confetti | 90 pieces for 2.5 s |
| Defeat title drop | 420 ms |
| Grey fade | 1.2 s |

**Sound**

| Item | Value |
|---|---|
| Gain by group | ui and action 0.6, alert 0.9 |
| Gap: `thud` | 330 ms |
| Gap: `warning` | 2000 ms |
| Gap: `radar` | 3000 ms |
| Gap: `boom`, `send` | 150 ms |
| Gap: every other sound | 100 ms |
| Voices at once | at most 8 |
| Default setting | on, 50% |
| Storage key | `borderline.sound` holding `{ muted, volume }` |
| All MP3s together | under 500 KB |

**Minimap**

| Item | Value |
|---|---|
| Size | at most 240×160 CSS px |
| Loss cells | 24×24 tiles |
| Flashes | at most 12, each 1.5 s |
| Toggle | M key |
| Storage key | `borderline.minimap` |

**Budgets**
- `TerritoryField.apply`: under 2 ms per update on average (world map, 30 insane bots, in `npm run perf`).
- Renderer draw: under 8 ms per frame on average (frame probe in the browser test).

**Assets and URLs**
- Assets live under `public/` and load through `${import.meta.env.BASE_URL}`: `sounds/<file>.mp3`, `maps/world.bin` and `favicon.svg`.

## Review Focus

1. **WebGL2 missing, or its context lost mid-match:** the game keeps running in the flat look with no errors. Tests: Task 5 (`?look=flat`) and Task 6 (`loseContext`).
2. **Browser storage blocked (private mode):** sound and minimap settings fall back to their defaults without throwing. Tests: Task 11 (`safeStorage` with a throwing store) and Task 13 (the minimap uses `safeStorage`).
3. **No audio, or a file that won't load or decode:** the game is silent and nothing reaches the console as an error. Tests: Task 12 (`WebAudioOutput` without `AudioContext`) and Task 12 e2e (no console errors).
4. **A big war with 40 bots:** no sound spam, and the map keeps up. Tests: Task 11 (gaps and voice limit), Task 4 (perf budget) and Task 6 (frame probe).
5. **Window resized, or zoomed to 0.5 or 32:** the GL map stays aligned with the 2D overlay and with clicks. Tests: Task 5 (resize and zoom samples).

## File Structure

**New: map look** (`src/client/render/look/`)
- `palette.ts` — the natural palette.
- `terrainLook.ts` — static per-tile look data.
- `territoryField.ts` — owner, edge glow and capture time per tile, with dirty blocks.
- `shaders.ts` — the GLSL sources.
- `glMap.ts` — WebGL2 textures, the draw call, sampling and context loss.

**New: sound** (`src/client/audio/`)
- `catalog.ts` — sound names, files, groups and gaps.
- `synth.ts` — the made-in-code sounds, plus a WAV encoder.
- `director.ts` — which sounds an update makes.
- `mixer.ts` — gaps, voices, volume, mute, pause, saved settings.
- `webAudio.ts` — the browser output.

**New: user interface** (`src/client/ui/`)
- `logo.ts` — badge SVG and logo element.
- `segmented.ts` — segmented radio buttons.
- `fakeNations.ts` — made-up nations for the title backdrop.
- `titleBackdrop.ts` — the drifting world map behind the menu.
- `countUp.ts` — the counting easing.
- `confetti.ts` — confetti pieces.
- `buildIcon.ts` — icon canvases for the build buttons.
- `soundControls.ts` — speaker button and volume slider.
- `minimapGeometry.ts` — the minimap's maths and flash rules.
- `minimap.ts` — the minimap panel.

**New: other files**
- `src/client/storage.ts` — `safeStorage()`.
- `scripts/build-sounds.ts` — builds `public/sounds/*`.
- `public/favicon.svg` and `public/sounds/*`.
- `e2e/look.spec.ts`, `e2e/sound.spec.ts`, `e2e/minimap.spec.ts` and `e2e/screenshots.spec.ts`.

**Modified**

| File | What changes |
|---|---|
| `src/shared/constants.ts` | the name |
| `src/worker/protocol.ts` | `LookOptions`, `look` and `fronts` |
| `src/sim/snapshot.ts` | `lookOptions`, `buildInit(match, look)` and `fronts` |
| `src/worker/sim.worker.ts` | passes the look options |
| `src/client/state.ts` | `fronts`, `gained`, `lost` |
| `src/client/render/palette.ts` | `TERRAIN_COLORS` from the natural palette |
| `src/client/render/renderer.ts` | the GL layer, fallback, grey fade and territory image |
| `src/client/main.ts` | wires everything together |
| `src/client/input.ts` | the M key |
| `src/client/ui/hud.ts` | icons |
| `src/client/ui/menu.ts` | rebuilt |
| `src/client/ui/endScreen.ts` | animations |
| `src/client/ui/dom.ts` | `showPanel` |
| `src/client/testApi.ts` | test hooks |
| `src/client/styles.css` | the shared style |
| `src/client/testing/fixtures.ts` | the new init fields |
| `index.html` | title and icon |
| `scripts/perf.ts` | the territory-field budget |
| `package.json` | the `build:sounds` script |
| `.gitignore` | `.cache/` |
| `README.md` and `docs/decisions.md` | Step B notes and credits |
| `docs/screenshots/` | new screenshots, with the old ones kept as `*-before.png` |
| `e2e/basic.spec.ts` | the menu test uses the segmented buttons |

## Conventions

- **"Run → FAIL"** means `npx vitest run <files>`, or `npx playwright test <files>` for e2e, fails for the stated reason.
- **"Run → PASS"** means the same command passes and `npm run typecheck` reports 0 errors.
- **"Commit"** means `git add -A && git commit -m "<message>"` with the attribution trailer.
- The e2e web server builds the app first, so a type error fails every e2e test.

---

## Milestone 1 — Name, data and protocol

### Task 1: Name, logo and tab icon

**Files:**
- Modify: `src/shared/constants.ts`, `index.html`, `README.md` (title line), `e2e/basic.spec.ts`
- Create: `src/client/ui/logo.ts`, `public/favicon.svg`
- Test: `src/client/ui/logo.test.ts`

**Interfaces:**
- Produces:
  - `GAME_NAME = 'Borderline'`
  - `LOGO_BLUE = '#3b82f6'` and `LOGO_RED = '#ef4444'`
  - `badgeSvg(): string`
  - `createLogo(size: 'large' | 'small'): HTMLElement`. It returns `div.logo.logo-<size>`, holding the badge's inline SVG and `span.logo-word` with the text "BORDERLINE".

- [ ] **Step 1: Write the failing tests**

```ts
// src/client/ui/logo.test.ts
it('the tab icon file is exactly the badge', () => {
  const file = readFileSync(new URL('../../../public/favicon.svg', import.meta.url), 'utf8');
  expect(file).toBe(`${badgeSvg()}\n`);
});
it('the badge is a 100×100 globe, blue on the left and red on the right, cut by a jagged white border', () => {
  const svg = badgeSvg();
  expect(svg).toContain('viewBox="0 0 100 100"');
  expect(svg).toContain(LOGO_BLUE);
  expect(svg).toContain(LOGO_RED);
  const pts = /class="border"[^>]*points="([^"]+)"/.exec(svg)![1].trim().split(/\s+/).map((p) => p.split(',').map(Number));
  expect(pts.length).toBeGreaterThanOrEqual(7);
  expect(pts[0][1]).toBeLessThanOrEqual(2);
  expect(pts.at(-1)![1]).toBeGreaterThanOrEqual(98);
  for (const [x] of pts) expect(x).toBeGreaterThan(35), expect(x).toBeLessThan(65);
  // jagged: the x direction keeps flipping
  const turns = pts.slice(2).filter((p, i) => Math.sign(p[0] - pts[i + 1][0]) !== Math.sign(pts[i + 1][0] - pts[i][0]));
  expect(turns.length).toBeGreaterThanOrEqual(4);
});
```

In `e2e/basic.spec.ts` 'menu starts a game', add `await expect(page).toHaveTitle('Borderline');` before Play.

- [ ] **Step 2: Run → FAIL.** `logo.ts` doesn't exist yet.
- [ ] **Step 3: Implement the badge, the logo and the name**
  - **Badge:** a `clipPath` circle (r 47). Fill the left half with `LOGO_BLUE` and the right half with `LOGO_RED`, split along the jagged polyline.
    - Add three or four lighter continent paths and faint white grid lines (opacity about 0.25).
    - Draw the polyline `class="border"` in white, stroke-width 4, with a white rim circle on top.
    - No `<text>`. The output must be stable: no random values.
  - **`createLogo`:** sets the badge with `innerHTML`.
  - **Name:** set `GAME_NAME`.
  - **`index.html`:** add `<title>Borderline</title>` and `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`.
  - **Tab icon file:** write `public/favicon.svg` with `npx tsx -e "import('./src/client/ui/logo.ts').then(m => process.stdout.write(m.badgeSvg() + '\n'))" > public/favicon.svg`.
  - **README:** change the title to `# Borderline`.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/ui/logo.test.ts`). Also run `npx playwright test e2e/basic.spec.ts -g "menu"` → PASS.
- [ ] **Step 5: Commit** "feat: the game is called Borderline, with a split-globe badge and tab icon"

### Task 2: Look options, fronts, gained and lost land

**Files:**
- Modify: `src/worker/protocol.ts`, `src/sim/snapshot.ts`, `src/worker/sim.worker.ts`, `src/client/state.ts`, `src/client/testing/fixtures.ts`, plus the tests that build an `InitPayload` or a `GameUpdate`. Typecheck will list them.
- Test: `src/sim/snapshot.test.ts`, `src/client/state.test.ts`

**Interfaces:**
- **Protocol** (`src/worker/protocol.ts`):
  - `interface LookOptions { latitude: { top: number; bottom: number }; seed: number; dryBands: boolean }`
  - `InitPayload.look: LookOptions`
  - `GameUpdate.fronts: [NationId, NationId][]`
- **Snapshot** (`src/sim/snapshot.ts`):
  - `lookOptions(choice: MapChoice): LookOptions`
  - `buildInit(match: Match, look: LookOptions): InitPayload`
- **Client state:**
  - `ClientState.fronts: [NationId, NationId][]`
  - `ClientState.gained: number` — tiles that became the player's in the last update.
  - `ClientState.lost: TileIndex[]` — the player's tiles taken in the last update.

- [ ] **Step 1: Write the failing tests**

```ts
// snapshot.test.ts
it('lookOptions: the world map uses its projection, seed 1 and dry bands; random maps ±72° and their own seed', () => {
  expect(lookOptions({ kind: 'world' })).toEqual({ latitude: { top: 78, bottom: -58 }, seed: 1, dryBands: true });
  expect(lookOptions({ kind: 'random', size: 'small', seed: 99 })).toEqual({ latitude: { top: 72, bottom: -72 }, seed: 99, dryBands: false });
});
it('buildInit carries the look options it is given', () => {
  const look = { latitude: { top: 10, bottom: -10 }, seed: 3, dryBands: false };
  expect(buildInit(new Match(setup(plains(6, 4))), look).look).toEqual(look);
});
it('fronts lists each running attack between two nations once, sorted, without attacks on empty land', () => {
  // three nations side by side; 2 attacks 3, 1 attacks 2 twice, 1 expands into empty land
  ...
  expect(buildUpdate(m).fronts).toEqual([[1, 2], [2, 3]]);
});
// state.test.ts
it('counts the tiles the player gained and lists the tiles they lost in each update', () => {
  // player 1 owns tile 0; update: tile 0 → 2, tiles 1 and 2 → 1
  expect(state.gained).toBe(2);
  expect(state.lost).toEqual([0]);
  state.applyUpdate(emptyUpdate);
  expect(state.gained).toBe(0);
  expect(state.lost).toEqual([]);
});
it('keeps the fronts of the latest update', () => { ... expect(state.fronts).toEqual([[2, 3]]); });
```

Start the attacks with the existing attack command path (`applyCommand` with `{ type: 'attack' }`), the same way `attacks.test.ts` does. Don't push records by hand.

- [ ] **Step 2: Run → FAIL.** `lookOptions` and `fronts` don't exist yet.
- [ ] **Step 3: Implement**
  - `RANDOM_MAP_LATITUDE = 72` in `snapshot.ts`. The world latitudes come from `WORLD_PROJECTION.latMax` and `latMin`.
  - **Fronts:** `game.attacks` with `target !== 0`, deduplicated by pair, then sorted by attacker and then target.
  - **Worker:** calls `buildInit(match, lookOptions(options.map))`.
  - **`ClientState.applyUpdate`:** compares each changed tile's old owner with its new one before writing it. `applyInit` resets the three new fields.
  - **Fixtures:** `makeClientState` passes `look: { latitude: { top: 72, bottom: -72 }, seed: 1, dryBands: false }`.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/sim/snapshot.test.ts src/client/state.test.ts`), then `npm test`, all green.
- [ ] **Step 5: Commit** "feat(protocol): look options, front lines and the player's gained and lost land reach the page"

### Task 3: Terrain look data

**Files:**
- Create: `src/client/render/look/palette.ts`, `src/client/render/look/terrainLook.ts`
- Modify: `src/client/render/palette.ts`. `TERRAIN_COLORS` takes its values from `LOOK`, with water = `LOOK.water`.
- Test: `src/client/render/look/terrainLook.test.ts`

**Interfaces:**
- Consumes: `LookOptions` (Task 2).
- **Palette:** `LOOK = { deepWater: 0x1d4e7a, shallowWater: 0x3f86b5, water: 0x2b6596, sand: 0xe2d3a0, plains: 0x86ad5e, hills: 0x9c9a63, mountains: 0x8b8173, forest: 0x3f6e3c, dry: 0xc8b27b, snow: 0xf1f4f6 } as const`
- **Terrain look:**
  - `COAST_RANGE = 8`
  - `encodeCoast(s: number): number` and `decodeCoast(b: number): number`. A byte b stands for s = b / 255 × 16 − 8.
  - `interface TerrainLook { width: number; height: number; coast: Uint8Array; shade: Uint8Array; biome: Uint8Array }`
    - `biome` is RGBA per tile: forest, dry, snow, and rock (0 for plains or water, 128 for hills, 255 for mountains).
  - `buildTerrainLook(width: number, height: number, terrain: Uint8Array, look: LookOptions): TerrainLook`

- [ ] **Step 1: Write the failing tests.** A helper `terrainFrom(rows)` reads `.` as water, `#` as plains, `^` as hills and `M` as mountains.

```ts
it('coast distance is positive on land, negative on water, about ±0.5 either side of the shore', () => {
  // 20×9: water left half, plains right half
  expect(decodeCoast(look.coast[at(10, 4)])).toBeCloseTo(0.5, 1);
  expect(decodeCoast(look.coast[at(9, 4)])).toBeCloseTo(-0.5, 1);
  expect(decodeCoast(look.coast[at(16, 4)])).toBeGreaterThan(5);
});
it('coast distance stops at ±COAST_RANGE', () => { /* 60×10 open sea with one island */ expect(decodeCoast(look.coast[far])).toBeCloseTo(-8, 1); });
it('snow follows latitude: none near the equator, full beyond 68°', () => {
  // 10×40 plains, latitude 80 / -80
  expect(look.biome[4 * at(5, 20) + 2]).toBe(0);
  expect(look.biome[4 * at(5, 0) + 2]).toBe(255);
  expect(look.biome[4 * at(5, 39) + 2]).toBe(255);
});
it('high mountains get snow caps even at the equator', () => { /* 9×9 mountain block in plains, latitude 5/-5 */ expect(look.biome[4 * centre + 2]).toBeGreaterThanOrEqual(200); });
it('never puts forest on beaches, snow or mountains', () => {
  for each tile with forest > 0: terrain is plains or hills, decodeCoast >= 1.5, snow < 77
});
it('puts forest on a fair part of a big green map', () => { /* 120×80 plains+hills, latitude 30/-30 */ expect(forested / eligible).toBeGreaterThan(0.05); });
it('dry bands make the subtropics drier than the equator', () => { /* 40×80 plains, latitude 40/-40, dryBands true */ expect(meanDry(rowsAt25deg)).toBeGreaterThan(meanDry(rowsNearEquator) + 50); });
it('the same inputs give the same look, and another seed moves the forests', () => {
  expect(buildTerrainLook(...seed 4)).toEqual(buildTerrainLook(...seed 4));
  expect(forestOf(seed 4)).not.toEqual(forestOf(seed 5));
});
it('hill shading lights the top-left side of a mountain and darkens the bottom-right side', () => {
  expect(look.shade[upLeftOfPeak]).toBeGreaterThan(140);
  expect(look.shade[downRightOfPeak]).toBeLessThan(116);
});
```

- [ ] **Step 2: Run → FAIL.** The module doesn't exist yet.
- [ ] **Step 3: Implement `buildTerrainLook`**
  - **Coast:** an exact Euclidean distance transform (Felzenszwalb–Huttenlocher, separable 1-D passes), once for land to the nearest water tile and once for water to the nearest land tile.
    - Land: s = d − 0.5. Water: s = −(d − 0.5).
    - Clamp to ±`COAST_RANGE`.
    - A map with no water, or no land, clamps everything to +8, or to −8.
  - **Height:** water 0, plains 0.2, hills 0.5, mountains 0.9, plus `noise(x/12, y/12) × 0.08` on land. Then a radius-2 box blur, applied twice.
  - **Shade:** `128 + (dx + dy) × K`, using central differences of the blurred height (y points down), clamped to 0–255. Water is 128.
  - **Latitude** of row y: `top + (bottom − top) × (y + 0.5) / height`.
  - **Snow:** `clamp((|lat| − 58) / 10, 0, 1)` on land. Mountains with blurred height ≥ 0.72 get snow 1.
  - **Dry:**
    - With `dryBands`: a smooth bump that is 1 between 20° and 30° and 0 below 12° or above 38°, mixed with noise.
    - Without: noise only.
    - Dry is 0 where snow > 0.5.
  - **Forest:** only on plains and hills, where coast ≥ 1.5 and snow < 0.3. It comes from two noise octaves, reduced by dryness.
  - **Noise:** `createNoise2D(() => rng.next())` with `new Rng(look.seed)`.
- [ ] **Step 4: Run → PASS.** Also run `npx vitest run src/client/render/territoryLayer.test.ts`, which still passes on the new colours.
- [ ] **Step 5: Commit** "feat(look): natural terrain look data — smooth coasts, hill shading, forests, dry land and snow"

### Task 4: Territory field and its performance budget

**Files:**
- Create: `src/client/render/look/territoryField.ts`
- Modify: `scripts/perf.ts`
- Test: `src/client/render/look/territoryField.test.ts`

**Interfaces:**
- **Constants:** `EDGE_MAX = 4`, `WATER_OWNER = 255`, `NEVER = -1e9`, `BLOCK = 32`
- `interface Rect { x: number; y: number; w: number; h: number }`
- `class TerritoryField`:
  - `constructor(width: number, height: number, terrain: Uint8Array)`
  - `readonly owner: Uint8Array`, `readonly edge: Uint8Array`, `readonly captured: Float32Array`
  - `apply(owner: Uint16Array, tiles: ArrayLike<number>, now: number): void`
  - `takeDirty(): Rect[]`
- `fullEdge(width: number, height: number, owner: Uint8Array): Uint8Array`
- **How `edge` is stored:** border tiles hold 0. Other owned land tiles hold `round(255 × min(d, EDGE_MAX) / EDGE_MAX)`, where d is the chamfer distance to the nearest border tile (1 for a straight step, 1.5 for a diagonal one). Water and unowned land hold 255.
- **What a border tile is:** owned land with a 4-neighbour that is land (not `WATER_OWNER`) and has a different owner, unowned land included.

- [ ] **Step 1: Write the failing tests**

```ts
it('water holds WATER_OWNER and owned land holds its nation', ...);
it('captured records when each tile last changed owner; the rest stay NEVER', ...);
it('edge is 0 on a border, 64 one tile in, 255 from four tiles in and on unowned land', () => {
  // 20×5 plains: nation 1 on x < 10, nation 2 on x >= 10
  expect(f.edge[at(9, 2)]).toBe(0); expect(f.edge[at(8, 2)]).toBe(64); expect(f.edge[at(5, 2)]).toBe(255);
});
it('a coast is not a border: owned land beside water only has full edge', ...);
it('after many random updates, edge equals a full recompute', () => {
  // 100×80 plains/water mix, Rng(7); 40 rounds of 1–400 random owner changes
  expect([...f.edge]).toEqual([...fullEdge(100, 80, f.owner)]);
});
it('takeDirty returns each touched 32×32 block once, clamped to the map, then nothing', () => {
  // 70×40 map; change tile (69, 39)
  expect(f.takeDirty()).toEqual([{ x: 32, y: 32, w: 32, h: 8 }, { x: 64, y: 32, w: 6, h: 8 }]);
  expect(f.takeDirty()).toEqual([]);
});
```

- [ ] **Step 2: Run → FAIL.** The module doesn't exist yet.
- [ ] **Step 3: Implement**
  - **`apply` on each changed tile:**
    - Write the owner byte. Water stays `WATER_OWNER`.
    - Set `captured = now`.
    - Mark dirty every block that meets the square of ±(EDGE_MAX + 1) tiles around the tile.
  - **Each dirty block** then recomputes `edge` inside a window of the block ± (EDGE_MAX + 2), clamped to the map:
    - Find the border flags from the full owner array.
    - Run a two-pass chamfer (3×3 mask, weights 1 and 1.5).
    - Write back only the block's own tiles.
    - Because every path of length ≤ EDGE_MAX stays inside the window, the result equals `fullEdge`.
  - **The constructor** fills `owner` (water = 255, land = 0), `captured = NEVER` and `edge = 255`.
  - **`takeDirty`** returns the dirty blocks in block-index order, then clears them.
  - **`scripts/perf.ts`:**
    - Time `buildTerrainLook` once for the world map and print it.
    - Each timed tick, pass the tiles from `game.drainChangedTiles()` into `field.apply(game.owner, tiles, i / 10)`, and time each `apply` separately.
    - Print the mean, p95 and max. Exit 1 when the mean is ≥ 2 ms, as well as on the existing 20 ms tick budget.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/render/look/territoryField.test.ts`). Then run `npm run perf` and check that both budgets print as within budget.
- [ ] **Step 5: Commit** "feat(look): territory field — owner bytes, inner-glow distance by blocks, capture times"

Push: `git push -u origin claude/clever-cray-5279az`. Update pull request #2's title and description to say it now also carries Step B: Borderline's new look and sound, in progress.

---

## Milestone 2 — The graphics-chip map

### Task 5: GL map, terrain

**Files:**
- Create: `src/client/render/look/shaders.ts`, `src/client/render/look/glMap.ts`, `e2e/look.spec.ts`
- Modify: `src/client/render/renderer.ts`, `src/client/main.ts`, `src/client/styles.css`, `src/client/testApi.ts`
- Test: `src/client/render/look/shaders.test.ts`, `e2e/look.spec.ts`

**Interfaces:**
- Consumes: `TerrainLook`, `buildTerrainLook` and `LOOK` (Task 3), `TerritoryField` (Task 4), and `state.init.look` (Task 2).
- **Shaders:** `MAP_VERTEX: string` and `mapFragment(): string`, a GLSL ES 3.00 source with the `LOOK` colours, `COAST_RANGE`, `EDGE_MAX` and `WATER_OWNER` written in.
- **`interface GlView`:** `{ x: number; y: number; zoom: number; time: number; grey: number }`. Camera x and y are in tiles, zoom is CSS px per tile, and time is in seconds.
- **`class GlMap`:**
  - `static create(canvas: HTMLCanvasElement, look: TerrainLook, colors: Map<NationId, number>): GlMap | null` — null without WebGL2, or when a shader fails.
  - `get lost(): boolean`
  - `draw(view: GlView): void`
  - `sample(view: GlView, sx: number, sy: number): [number, number, number]` — draws, then reads back one pixel.
  - `debugLoseContext(): void`
- **`Renderer`:**
  - `constructor(..., gl: GlMap | null)`
  - `get look(): 'gl' | 'flat'`
  - `get frameMs(): number[]` — the last 240 draw times.
  - `territoryImage(): HTMLCanvasElement` — the flat 1 px-per-tile picture, kept up to date in both looks. The minimap uses it.
- **Test API:**
  - `look(): 'gl' | 'flat'`
  - `sampleMap(tile: number): [number, number, number]`
  - `frameStats(): { mean: number; frames: number }`
  - `zoomTo(zoom: number, tile: number): void`
  - `findWaterTile(): number | null` — the water tile farthest from land.

- [ ] **Step 1: Write the failing tests**

```ts
// shaders.test.ts
it('builds a GLSL ES 3.00 fragment shader with the palette and limits written in', () => {
  const src = mapFragment();
  expect(src.startsWith('#version 300 es')).toBe(true);
  expect(src).toContain('const float COAST_RANGE = 8.0;');
  expect(src).toContain('const float EDGE_MAX = 4.0;');
  expect(src).toContain('const uint WATER_OWNER = 255u;');
  expect(src).toContain(vec3Literal(LOOK.deepWater));
});
```

```ts
// e2e/look.spec.ts (random small map, seed 7, 4 easy bots, ?test=1)
test('the map is drawn by the graphics chip: deep water is blue, and land is not', ...)
  // look() === 'gl'; deepest water tile (from MapInfo via findLandTile? use a new test hook `findWaterTile('deep')`):
  // b > r + 40 && b > g; a land tile: not (b > r + 40)
test('the flat look is still there with ?look=flat', ...)  // look() === 'flat'; sampled water equals TERRAIN_COLORS water
test('the map stays lined up after a resize and at both zoom limits', ...)
  // setViewportSize(900, 700); then zoomTo(0.5, land) and zoomTo(32, land): sampleMap(land) is not blue, sampleMap(deep) is blue
```

Add `findWaterTile(): number | null` to the test API: the water tile farthest from land, using `MapInfo`.

- [ ] **Step 2: Run → FAIL.** `shaders.ts`, `look()` and `sampleMap` are missing.
- [ ] **Step 3: Implement**
  - **Draw call:** a full-screen triangle drawn from `gl_VertexID`. There are no vertex buffers.
  - **Textures:**
    - Static: `coast` and `shade` (R8, LINEAR), and `biome` (RGBA8, LINEAR).
    - Changing: `owner` (R8UI, NEAREST), `edge` (R8, LINEAR) and `captured` (R32F, NEAREST).
    - Tables: `palette` (RGBA8, 256×1) and `fronts` (R8UI, 64×64).
    - Use `UNPACK_ALIGNMENT` 1. Partial uploads use `UNPACK_ROW_LENGTH`, `UNPACK_SKIP_PIXELS` and `UNPACK_SKIP_ROWS`, so nothing gets copied.
  - **Fragment shader** in this task: terrain only.
    - Map position `p = camera + (fragCoord with y flipped) / zoom`.
    - Coast `s` comes from the bilinear `coast` sample. `land = smoothstep(-aa, aa, s)`, with `aa = 0.75 * fwidth(s)`.
    - Water shades from shallow to deep with `clamp(-s/6, 0, 1)`, plus a shimmer `0.035 * sin(...)·sin(...)` driven by time.
    - The land colour is the rock and biome mix, multiplied by `0.75 + 0.5 * shade`.
    - Sand goes where `s < 0.6`.
    - The grey uniform comes last.
  - **Context loss:** `webglcontextlost` calls `preventDefault()` and sets `lost`.
  - **Renderer:**
    - When `gl && !gl.lost`: `clearRect`, then `gl.draw`, then the overlays.
    - Otherwise: today's flat drawing.
    - It times `draw()` into `frameMs`.
  - **`main.ts`:**
    - Insert `canvas.map-gl` before `canvas.map`, and size both on resize.
    - Use GL unless `?look=flat` is set or `GlMap.create` returns null.
  - **CSS:** `canvas.map-gl { position: absolute; inset: 0; pointer-events: none; }`
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/render/look/shaders.test.ts`, then `npx playwright test e2e/look.spec.ts`). Save `test-results/look-terrain.png` from the first test and look at it.
- [ ] **Step 5: Commit** "feat(look): the map is drawn by the graphics chip — natural terrain, smooth coasts, shimmering water"

### Task 6: GL map, territories

**Files:**
- Modify: `src/client/render/look/glMap.ts`, `src/client/render/look/shaders.ts`, `src/client/render/renderer.ts`, `src/client/testApi.ts`, `e2e/look.spec.ts`
- Test: `src/client/render/look/glMap.test.ts` (pure parts), `e2e/look.spec.ts`

**Interfaces:**
- **New on `GlMap`:**
  - `syncTerritory(field: TerritoryField): void` uploads `field.takeDirty()` for owner, edge and captured.
  - `setFronts(table: Uint8Array): void`
- `frontTable(fronts: [NationId, NationId][]): Uint8Array` — 64×64, with 1 at index `a * 64 + b`. Pairs with an id ≥ 64 are left out.
- **Test API:** `loseContext(): void`

- [ ] **Step 1: Write the failing tests**

```ts
// glMap.test.ts
it('frontTable marks each attacker→target pair and nothing else', () => {
  const t = frontTable([[1, 2], [5, 3]]);
  expect(t[1 * 64 + 2]).toBe(1); expect(t[5 * 64 + 3]).toBe(1);
  expect(t.reduce((s, v) => s + v, 0)).toBe(2);
});
```

```ts
// e2e/look.spec.ts
test("the player's land is tinted toward the player's colour", ...)
  // sample the player-interior tile before spawn (terrain) and after: colour distance to PLAYER_COLOR shrinks by > 30
test('a lost graphics context falls back to the flat look and keeps drawing', ...)
  // loseContext(); look() === 'flat'; sampled water equals the flat water colour; no page errors
test('drawing a frame stays cheap on the world map with 40 bots', ...)
  // ?map=world&bots=40; spawn; wait 4 s; frameStats().frames > 60 and mean < 8
```

- [ ] **Step 2: Run → FAIL.** `frontTable` and `loseContext` are missing, and the land isn't tinted yet.
- [ ] **Step 3: Implement**
  - **Owner neighbourhood:** the four owners around `p − 0.5` are fetched with `texelFetch`. Each distinct owner's weight is the sum of its bilinear weights. A is the heaviest owner, B the heaviest different one, and `e = wA − wB`.
  - **Land owner:** if A is `WATER_OWNER`, the land owner is B. Otherwise it is A.
  - **Tint:** `mix(col, nation, 0.5 * land)` when the land owner is between 1 and 254.
  - **Line:** drawn only when neither A nor B is water. `px = e / max(fwidth(e), 1e-4)`, and `line = 1 − smoothstep(0.75, 1.75, px)`. The line colour is the nation colour lightened 35%.
  - **Glow:** `g = (1 − edge/255)²`, which adds `0.25 × g` of the lightened colour.
  - **Shimmer:** `age = time − captured`. Below 1 s, mix toward white by `0.35 × (1 − age)`.
  - **Front line:** when `fronts[A][B]` or `fronts[B][A]` is set, the line is 3 px wide and pulses at 1.5 Hz: `0.5 + 0.5 sin(2π·1.5·t)` controls the mix toward white.
  - **Renderer:**
    - Keeps a `TerritoryField`, built in `syncTerritory` and fed the same drained tiles as the flat layer.
    - Calls `gl.syncTerritory` before `draw`.
    - Calls `gl.setFronts(frontTable(state.fronts))` when the fronts change.
    - Uses the player's capture time `now = performance.now() / 1000`.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/render/look/glMap.test.ts`, then `npx playwright test e2e/look.spec.ts`). Look at `test-results/look-territories.png`, zoomed to 8 on a border.
- [ ] **Step 5: Commit** "feat(look): tinted-glass territories, glowing borders, capture shimmer and pulsing front lines"

Push.

---

## Milestone 3 — Panels and screens

### Task 7: One shared style, panel entry and build-button icons

**Files:**
- Modify: `src/client/styles.css`, `src/client/ui/dom.ts`, `src/client/ui/hud.ts`, `src/client/ui/diplomacyPanel.ts`, `src/client/ui/requests.ts`, `src/client/ui/contextMenu.ts`, `src/client/main.ts`
- Create: `src/client/ui/buildIcon.ts`, `e2e/ui.spec.ts`

**Interfaces:**
- `showPanel(el: HTMLElement): void` — removes `.hidden` and restarts the `.enter` animation.
- `createBuildIcon(type: BuildingType, color: number, cssSize = 22): HTMLCanvasElement` — `canvas.build-icon`, drawn at `devicePixelRatio`.
- `new Hud(state, onBuild, playerColor: number)`

- [ ] **Step 1: Write the failing e2e test**

```ts
test('every build button shows its icon, and panels share the rounded glass style', async ({ page }) => {
  // autostart small random map
  await expect(page.locator('.hud button.build canvas.build-icon')).toHaveCount(11);
  for (const sel of ['.hud', '.leaderboard', '.pause']) {
    expect(await page.locator(sel).evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px');
  }
});
```

- [ ] **Step 2: Run → FAIL.** There are no icons yet, and the radius is 10px.
- [ ] **Step 3: Implement**
  - **Tokens** on `:root`: `--glass: rgba(15,23,42,0.72)`, `--glass-strong: rgba(15,23,42,0.9)`, `--line: rgba(148,163,184,0.22)`, `--radius: 12px`, `--shadow: 0 10px 30px rgba(2,6,23,0.45)`, `--enter-ms: 160ms`.
  - **`.panel`:** uses the tokens, with `backdrop-filter: blur(10px) saturate(1.2)`.
  - **Buttons:** the hover state lightens and the active state presses down 1 px.
  - **Entry animation:** `.enter` runs `@keyframes panel-in` (from opacity 0, translateY(6px)) for `var(--enter-ms)`.
  - **Reduced motion:** `@media (prefers-reduced-motion: reduce)` turns off all animation and transition.
  - **Headings:** weight 800, letter-spacing 0.08em.
  - **`showPanel` callers:** the diplomacy panel's `open`, each new request card, and the context menu's `open`.
- [ ] **Step 4: Run → PASS** (`npx playwright test e2e/ui.spec.ts e2e/basic.spec.ts`).
- [ ] **Step 5: Commit** "feat(ui): one shared glass style, panels that slide in, icons on the build buttons"

### Task 8: Title screen

**Files:**
- Create: `src/client/ui/segmented.ts`, `src/client/ui/fakeNations.ts`, `src/client/ui/titleBackdrop.ts`
- Modify: `src/client/ui/menu.ts`, `src/client/main.ts`, `src/client/styles.css`, `e2e/basic.spec.ts`
- Test: `src/client/ui/fakeNations.test.ts`, `e2e/basic.spec.ts`

**Interfaces:**
- **Segmented buttons:**
  - `interface Segmented<T extends string> { readonly el: HTMLElement; readonly value: T; onChange: ((value: T) => void) | null }`
  - `createSegmented<T extends string>(label: string, options: readonly { value: T; text: string }[], initial: T): Segmented<T>` — `div.segmented[role=radiogroup][aria-label]` holding `button[role=radio][aria-checked]`. Click selects an option, and ArrowLeft and ArrowRight move the selection.
- **Made-up nations:** `growNations(width: number, height: number, terrain: Uint8Array, count: number, share: number, seed: number): Uint16Array`
- **Backdrop:** `startBackdrop(host: HTMLElement): () => void` — returns a function that stops it.
- `createMenu(onPlay, debug)` keeps its signature.

- [ ] **Step 1: Write the failing tests**

```ts
// fakeNations.test.ts (60×40 map: land blob in water)
it('grows the given number of nations over about the given share of land, never on water', ...)
  // ids 1..6 all present; owned land / land within [0.33, 0.37] for share 0.35; no water owned
it("each nation's land is connected", ...)  // flood fill per id reaches all its tiles
it('the same seed gives the same nations', ...)
```

```ts
// e2e/basic.spec.ts 'menu starts a game' becomes:
await page.goto('/game/?test=1');
await expect(page).toHaveTitle('Borderline');
await expect(page.locator('.menu .logo')).toBeVisible();
await expect(page.locator('canvas.backdrop')).toHaveCount(1);
await page.getByRole('radio', { name: 'Random' }).click();
await page.getByRole('radio', { name: 'Small' }).click();
await page.getByLabel('Bots').fill('6');
await page.getByRole('radio', { name: 'Hard' }).click();
await page.getByRole('button', { name: 'Play' }).click();
await page.waitForFunction(() => window.__test?.state.phase === 'spawn');
expect(await page.evaluate(() => window.__test.state.init.width)).toBe(400);
await expect(page.locator('canvas.backdrop')).toHaveCount(0);
```

- [ ] **Step 2: Run → FAIL.** The module and the radios don't exist yet.
- [ ] **Step 3: Implement**
  - **`growNations`:** seeds `count` random land tiles at least 4 tiles apart, using `Rng(seed)`. It then grows round-robin, one BFS frontier step per nation per turn, until `share` of the land is owned.
  - **Backdrop:**
    - Fetches `maps/world.bin` and decodes it with `decodeWorldMap`.
    - Uses `buildTerrainLook` with `lookOptions({ kind: 'world' })`, plus a `TerritoryField` holding `growNations(..., 16, 0.35, 1)`.
    - Colours come from `nationColor(i, false)`.
    - Draws `canvas.backdrop` with `GlMap`, the camera drifting at 3 tiles/s with a slow zoom of 2.2 ± 0.3.
    - Any failure adds `.backdrop-fallback`, a dark radial gradient.
  - **Menu card:**
    - `createLogo('large')`.
    - The tagline.
    - Map segmented buttons.
    - `.random-only`: Size segmented buttons plus Seed.
    - Bots.
    - Difficulty segmented buttons.
    - Your name.
    - Play.
  - **`main.ts`:** starts the backdrop with the menu, and `start()` calls the stop function.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/ui/fakeNations.test.ts`, then `npx playwright test e2e/basic.spec.ts`). Look at `test-results/menu.png`.
- [ ] **Step 5: Commit** "feat(ui): title screen with the logo, segmented choices and a drifting world map behind it"

### Task 9: Win and lose screens, grey fade

**Files:**
- Create: `src/client/ui/countUp.ts`, `src/client/ui/confetti.ts`
- Modify: `src/client/ui/endScreen.ts`, `src/client/render/renderer.ts`, `src/client/main.ts`, `src/client/testApi.ts`, `src/client/styles.css`, `e2e/ui.spec.ts`
- Test: `src/client/ui/countUp.test.ts`, `e2e/ui.spec.ts`

**Interfaces:**
- `countUp(target: number, elapsedMs: number, durationMs = 800): number` — ease-out cubic, floored, and exactly `target` once `elapsedMs ≥ durationMs`.
- `createConfetti(color: number, count = 90): HTMLElement` — `div.confetti` holding `count` `<i>` pieces.
- `new EndScreen(state, landCount, onMenu, onDefeat: () => void)`
- `Renderer.setGrey(on: boolean): void` and `Renderer.grey: number`, from 0 to 1.
- **Test API:**
  - `forceResult(result: GameResult): void` — test only. It sets `state.result` and refreshes the user interface.
  - `grey(): number`

- [ ] **Step 1: Write the failing tests**

```ts
it('starts at 0, ends exactly at the target and never goes past it', () => {
  expect(countUp(1234, 0)).toBe(0);
  expect(countUp(1234, 800)).toBe(1234);
  expect(countUp(1234, 5000)).toBe(1234);
  for (let t = 0; t <= 800; t += 50) expect(countUp(1234, t)).toBeLessThanOrEqual(1234);
});
it('is past halfway at half time (ease-out)', () => expect(countUp(1000, 400)).toBeGreaterThan(500));
```

```ts
test('the victory screen pops in with confetti and counts the stats up', ...)
  // pause; forceResult({ winners: [me], reason: 'conquest' }); '.end-card.pop' visible; '.confetti i' count 90;
  // 'Tiles captured' value polls to the final number
test('the defeat screen drops in and greys the map', ...)
  // forceResult({ winners: [2], reason: 'conquest' }); '.end-card.drop' visible; poll grey() → 1 within 2500 ms
```

- [ ] **Step 2: Run → FAIL.** The module and the hooks don't exist yet.
- [ ] **Step 3: Implement**
  - **CSS:**
    - `.end-card.pop` uses `@keyframes pop` (scale 0.9 → 1) over 350 ms.
    - `.victory.shine` moves a gradient across the title.
    - `.end-card.drop` (translateY(-40px) → 0, ease-in) runs over 420 ms.
    - Confetti pieces fall for 2.5 s with per-piece custom properties. `.confetti` has `pointer-events: none`.
  - **Count-up:** stats count with `requestAnimationFrame` and `countUp`.
  - **Grey fade:**
    - GL: ramps the shader's `grey` over 1200 ms.
    - Flat: the class `.grey` on `canvas.map` (`filter: grayscale(1)`, `transition: filter 1.2s`).
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/ui/countUp.test.ts`, then `npx playwright test e2e/ui.spec.ts`).
- [ ] **Step 5: Commit** "feat(ui): animated victory and defeat screens, confetti, counting stats and a grey fade on defeat"

Push.

---

## Milestone 4 — Sound

### Task 10: Sound catalogue and sound files

**Files:**
- Create: `src/client/audio/catalog.ts`, `src/client/audio/synth.ts`, `scripts/build-sounds.ts`, `public/sounds/*.mp3`, `public/sounds/CREDITS.txt`
- Modify: `package.json` (add `"build:sounds": "tsx scripts/build-sounds.ts"`), `.gitignore` (add `.cache/`)
- Test: `src/client/audio/synth.test.ts`, `src/client/audio/catalog.test.ts`

**Interfaces:**
- `type SoundName = 'click' | 'place' | 'built' | 'send' | 'thud' | 'horn' | 'jet' | 'boom' | 'landing' | 'refused' | 'warning' | 'radar' | 'offer' | 'accepted' | 'declined' | 'betrayal' | 'lost' | 'warStart' | 'knockout' | 'victory' | 'defeat'`
- `interface SoundSpec { files: string[]; group: 'ui' | 'action' | 'alert'; gapMs: number }`
- `SOUNDS: Record<SoundName, SoundSpec>`
  - Gaps follow Global Constraints.
  - Groups:
    - `click` is ui.
    - `warning`, `radar`, `offer`, `accepted`, `declined`, `betrayal`, `lost`, `warStart`, `knockout`, `victory` and `defeat` are alerts.
    - The rest are actions.
  - `thud` has 5 files and `boom` has 2.
- `type SynthName = 'send' | 'horn' | 'jet' | 'warning' | 'radar' | 'declined' | 'betrayal' | 'knockout' | 'victory' | 'defeat'`
- `SYNTH_NAMES: readonly SynthName[]`
- `synthesize(name: SynthName, sampleRate: number): Float32Array` — deterministic: it uses a fixed-seed LCG for noise.
- `encodeWav(samples: Float32Array, sampleRate: number): Uint8Array` — 16-bit PCM, mono.

- [ ] **Step 1: Write the failing tests**

```ts
it.each(SYNTH_NAMES)('%s is 0.1–3 s long, never clips, and is not silent', (name) => {
  const s = synthesize(name, 44100);
  expect(s.length / 44100).toBeGreaterThanOrEqual(0.1); expect(s.length / 44100).toBeLessThanOrEqual(3);
  expect(Math.max(...s.map(Math.abs))).toBeLessThanOrEqual(1);
  expect(Math.sqrt(s.reduce((a, v) => a + v * v, 0) / s.length)).toBeGreaterThan(0.01);
});
it('comes out the same every time', () => expect(synthesize('jet', 22050)).toEqual(synthesize('jet', 22050)));
it('encodeWav writes a mono 16-bit RIFF header followed by the samples', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1]), 8000);
  // 'RIFF' … 'WAVE' 'fmt ' channels 1, rate 8000, bits 16, 'data' size 6, then 0, 32767, -32767
});
// catalog.test.ts
it('every file in the catalogue exists in public/sounds', ...);
it('all sound files together are under 500 KB', ...);
it('credits Kenney', () => expect(credits).toMatch(/Kenney/); );
```

- [ ] **Step 2: Run → FAIL.** The modules don't exist yet.
- [ ] **Step 3: Implement `synth.ts` and `catalog.ts`, then build the files with `npm run build:sounds`**
  - **Sources:** the script downloads the four pinned zips into `.cache/kenney/`:
    - `https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip`
    - `https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip`
    - `https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip`
    - `https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip`
  - **Picks:** the script takes the pack files the spec's table names, with `unzip -p`.
  - **Converting:** each file goes through `ffmpeg -ac 1 -ar 44100 -b:a 96k -af silenceremove=start_periods=1:start_threshold=-50dB` into `public/sounds/<file>.mp3`.
  - **Made-in-code sounds:** synthesised to WAV in `.cache/`, then converted the same way.
  - **Credits:** `CREDITS.txt` names Kenney (kenney.nl), CC0, and lists each file's source.
  - **Synth recipes:**
    - `send`: a band-passed noise sweep, 0.35 s.
    - `horn`: two detuned saws at 110 and 165 Hz, low-passed, with a slow attack, 1.2 s.
    - `jet`: noise through a rising band-pass, 0.9 s.
    - `warning`: square-wave beeps alternating 880 and 660 Hz, 2 × 0.18 s.
    - `radar`: a 1400 Hz sine ping with an exponential tail, 0.6 s.
    - `declined`: a falling two-note triangle, 0.4 s.
    - `betrayal`: a dissonant minor-second stab, 0.7 s.
    - `knockout`: a rising major third, 0.5 s.
    - `victory`: the major arpeggio C5 E5 G5 C6, then a held chord, 2.2 s.
    - `defeat`: falling G4 E♭4 C4 over a low C-minor chord, 2.4 s.
    - All normalised to a peak of 0.9.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/audio`). Check that `du -ch public/sounds/*.mp3` totals under 500 KB.
- [ ] **Step 5: Commit** "feat(sound): catalogue of 21 sounds — Kenney CC0 recordings plus tones made in code"

### Task 11: Sound director, mixer and safe storage

**Files:**
- Create: `src/client/audio/director.ts`, `src/client/audio/mixer.ts`, `src/client/storage.ts`
- Test: `src/client/audio/director.test.ts`, `src/client/audio/mixer.test.ts`, `src/client/storage.test.ts`

**Interfaces:**
- **Safe storage:**
  - `type KeyValue = Pick<Storage, 'getItem' | 'setItem'>`
  - `safeStorage(get: () => Storage | undefined = () => globalThis.localStorage): KeyValue` — every call is wrapped in try/catch. `getItem` returns null on failure, and `setItem` does nothing.
- **Director:**
  - `interface UpdateFacts { events: GameEvent[]; gained: number; units: UnitSnap[]; buildings: BuildingSnap[] | null }`
  - `class SoundDirector`: `constructor(me: NationId)` and `sounds(facts: UpdateFacts): SoundName[]`. Each sound appears at most once, in the order of the spec's table.
- **Mixer:**
  - `interface SoundOutput { play(name: SoundName, gain: number): number; setMasterGain(gain: number): void }` — `play` returns the sound's length in ms, or 0 if it didn't play.
  - Constants: `SETTINGS_KEY = 'borderline.sound'`, `MAX_VOICES = 8`, `GROUP_GAIN = { ui: 0.6, action: 0.6, alert: 0.9 }`
  - `class Mixer`:
    - `constructor(out: SoundOutput, now: () => number, storage: KeyValue)`
    - `readonly settings: { muted: boolean; volume: number }`
    - `setMuted(m: boolean): void`, `setVolume(v: number): void` and `setGamePaused(p: boolean): void`
    - `play(name: SoundName): boolean`
    - `readonly played: SoundName[]` — the last 50 sounds, for tests.

- [ ] **Step 1: Write the failing tests**

```ts
// director.test.ts — one row per line of the spec's sound table
it.each([
  ['built', { type: 'buildingDone', nation: ME, building: 'city', tile: 0 }],
  ['send', { type: 'attackStarted', attacker: ME, target: 2, troops: 10 }],
  ['warning', { type: 'attackStarted', attacker: 2, target: ME, troops: 10 }],
  ['boom', { type: 'bombed', by: ME, owner: 2, tile: 0 }],
  ['boom', { type: 'bombed', by: 2, owner: ME, tile: 0 }],
  ['landing', { type: 'landed', nation: ME, tile: 0, troops: 5 }],
  ['refused', { type: 'rejected', nation: ME, reason: 'x' }],
  ['radar', { type: 'radarWarning', nation: ME, from: 2, unit: 'bomber', tile: 0 }],
  ['offer', { type: 'request', request: { id: 1, kind: 'alliance', from: 2, to: ME, expiresAt: 9 } }],
  ['accepted', { type: 'requestResolved', requestId: 1, kind: 'alliance', from: ME, to: 2, accepted: true }],
  ['declined', { type: 'requestResolved', requestId: 1, kind: 'alliance', from: ME, to: 2, accepted: false }],
  ['betrayal', { type: 'betrayal', betrayer: 2, victim: ME }],
  ['lost', { type: 'buildingCaptured', from: ME, to: 2, building: 'port', tile: 0 }],
  ['lost', { type: 'buildingDestroyed', owner: ME, by: 2, building: 'port', tile: 0 }],
  ['warStart', { type: 'phase', phase: 'playing' }],
  ['knockout', { type: 'eliminated', nation: 3, by: ME }],
  ['victory', { type: 'gameOver', result: { winners: [ME], reason: 'conquest' } }],
  ['defeat', { type: 'gameOver', result: { winners: [2], reason: 'conquest' } }],
  ['defeat', { type: 'eliminated', nation: ME, by: 2 }],
])('%s for %o', (sound, event) => expect(new SoundDirector(ME).sounds(facts({ events: [event] }))).toEqual([sound]));
it("keeps quiet about other nations' business", ...);  // attackStarted 2→3, bombed 2→3, buildingDone of 2 → []
it('thud when the land grew', ...);  // gained 3 → ['thud']
it('horn for a new troop boat or warship, jet for a new bomber, paratroop plane or fighter, nothing for trade', ...);
it('place for a new building of mine, only once', ...);
it('plays victory or defeat at most once per match', ...);  // eliminated(ME) then gameOver(defeat) → second call []
// mixer.test.ts
it('starts unmuted at half volume', ...);  // master gain 0.5
it('loads and saves settings under borderline.sound', ...);
it('falls back to defaults when storage throws', ...);
it('keeps each sound its gap apart', ...);  // thud at 0 → yes, 200 → no, 330 → yes
it('plays at most 8 sounds at once', ...);  // 9th refused until the first ends
it('plays nothing while muted', ...);
it('plays only button clicks while the game is paused', ...);
it('passes the group gain to the output (alert 0.9, action 0.6) and the volume to the master gain, clamped 0–1', ...);
// storage.test.ts
it('safeStorage swallows errors from a broken store', ...);
```

- [ ] **Step 2: Run → FAIL.** The modules don't exist yet.
- [ ] **Step 3: Implement**
  - **Director:**
    - Remembers the unit ids and building ids it has seen.
    - The first `buildings: null` changes nothing.
    - New units come from `UnitSnap` owned by the player: `troopBoat` or `warship` gives `horn`, and `bomber`, `paraPlane` or `fighter` gives `jet`.
  - **Mixer:**
    - Keeps each voice's end time, from the length `out.play` returns.
    - Keeps the last time each name played, for the gaps.
    - Calls `setMasterGain(muted ? 0 : volume)` at start and on every change.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/audio src/client/storage.test.ts`).
- [ ] **Step 5: Commit** "feat(sound): director decides what each update sounds like; mixer keeps it tidy"

### Task 12: Web Audio output, sound controls and wiring

**Files:**
- Create: `src/client/audio/webAudio.ts`, `src/client/ui/soundControls.ts`, `e2e/sound.spec.ts`
- Modify: `src/client/main.ts`, `src/client/ui/pauseButton.ts` (or `main.ts`: its `onChange` also tells the mixer), `src/client/testApi.ts`, `src/client/styles.css`
- Test: `src/client/audio/webAudio.test.ts`, `e2e/sound.spec.ts`

**Interfaces:**
- **Output:** `class WebAudioOutput implements SoundOutput`
  - `constructor(baseUrl: string, ctor: (new () => AudioContext) | undefined = globalThis.AudioContext)`
  - `unlock(): void` — creates or resumes the context on the first gesture, and starts loading the files.
  - `suspend(): void` and `resume(): void`
  - `get state(): AudioContextState | 'none'`
  - Variants of a sound play in turn.
- **Controls:** `class SoundControls`
  - `readonly el: HTMLElement`
  - `constructor(mixer: Mixer)`
  - The button's accessible name is "Mute sound" or "Unmute sound". The range input is labelled "Volume", 0–100.
- **Test API:** `sound(): { state: string; muted: boolean; volume: number; played: SoundName[] }`

- [ ] **Step 1: Write the failing tests**

```ts
// webAudio.test.ts (Node: no AudioContext)
it('without Web Audio it stays silent: state none, play returns 0, nothing throws', () => {
  const out = new WebAudioOutput('/game/', undefined);
  out.unlock(); expect(out.state).toBe('none'); expect(out.play('click', 1)).toBe(0);
  out.setMasterGain(0.5); out.suspend(); out.resume();
});
```

```ts
// e2e/sound.spec.ts (console errors collected in every test and expected empty)
test('sound is on at half volume and running after the first click; sending troops whooshes', ...)
  // autostart; spawn click; sound().state === 'running', muted false, volume 0.5; attack → poll played contains 'send'
test('mute and volume are remembered after a reload', ...)
  // click 'Mute sound'; set Volume to 30; reload → sound().muted true, volume 0.3; button named 'Unmute sound'
test('muted, nothing plays', ...)  // mute; attack; played gains nothing after the mute
```

- [ ] **Step 2: Run → FAIL.** The modules and the controls don't exist yet.
- [ ] **Step 3: Implement**
  - **Output:**
    - Fetches `${baseUrl}sounds/<file>` and decodes it with `decodeAudioData`. A failure leaves that sound unloaded, with no console error.
    - Routes `AudioBufferSourceNode → GainNode(gain) → master GainNode → destination`.
  - **`main.ts`:**
    - At page start: create the output, then `new Mixer(output, () => performance.now(), safeStorage())`.
    - On the first `pointerdown` or `keydown` (capture phase): `output.unlock()`.
    - A capture-phase `click` listener on `button` elements calls `mixer.play('click')`.
    - `visibilitychange`: suspend or resume the output.
    - **In `buildGame`:**
      - Add `SoundControls` in a `.panel.sound` next to `.pause`.
      - Create `const director = new SoundDirector(init.playerId)`.
      - On each update, call `director.sounds({ events, gained: state.gained, units: state.units, buildings: update.buildings })`, then `mixer.play` each sound.
      - The pause button's `onChange` also calls `mixer.setGamePaused`.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/audio/webAudio.test.ts`, then `npx playwright test e2e/sound.spec.ts`).
- [ ] **Step 5: Commit** "feat(sound): sounds play in the game, with a speaker button and volume slider that are remembered"

Push.

---

## Milestone 5 — Minimap and finish

### Task 13: Minimap

**Files:**
- Create: `src/client/ui/minimapGeometry.ts`, `src/client/ui/minimap.ts`, `e2e/minimap.spec.ts`
- Modify: `src/client/input.ts` (adds the `toggleMinimap` action on `m`), `src/client/main.ts`, `src/client/testApi.ts`, `src/client/styles.css`
- Test: `src/client/ui/minimapGeometry.test.ts`, `e2e/minimap.spec.ts`

**Interfaces:**
- **Geometry:**
  - `MINIMAP_MAX = { w: 240, h: 160 }`
  - `interface MiniSize { w: number; h: number; scale: number }`
  - `minimapSize(mapW: number, mapH: number, max = MINIMAP_MAX): MiniSize`
  - `viewBox(cam: { x: number; y: number; zoom: number }, viewW: number, viewH: number, size: MiniSize): { x: number; y: number; w: number; h: number }`
  - `minimapToTile(mx: number, my: number, size: MiniSize): { x: number; y: number }`
  - `lossCells(tiles: readonly number[], width: number, cell = 24, max = 12): { x: number; y: number }[]` — the cell centres in tiles, the biggest cells first.
  - `interface Flash { x: number; y: number; kind: 'danger' | 'bomb'; start: number }`
  - `flashesFor(events: GameEvent[], lost: readonly number[], me: NationId, width: number, now: number): Flash[]`
- **Panel:** `class Minimap`
  - `constructor(state: ClientState, camera: Camera, image: () => HTMLCanvasElement, storage: KeyValue)`
  - `readonly el: HTMLElement`
  - `onUpdate(events: GameEvent[], now: number): void`
  - `draw(now: number, viewW: number, viewH: number): void`
  - `toggle(): void`
  - `get visible(): boolean`
- **Constant:** `MINIMAP_KEY = 'borderline.minimap'`
- **Test API:**
  - `camera(): { x: number; y: number; zoom: number }`
  - `minimap(): { visible: boolean; flashes: number }`

- [ ] **Step 1: Write the failing tests**

```ts
it("fits the map's shape inside 240×160", () => {
  expect(minimapSize(1500, 567)).toEqual({ w: 240, h: 91, scale: 0.16 });
  expect(minimapSize(400, 250)).toEqual({ w: 240, h: 150, scale: 0.6 });
  expect(minimapSize(100, 300)).toMatchObject({ h: 160, w: 53 });
});
it("the view box covers the camera's part of the map, clipped to the minimap", ...);
it('minimapToTile undoes the scale', ...);
it('lossCells groups lost tiles into 24-tile cells, biggest first, at most 12', ...);
it('flashesFor: red where the player lost land or was bombed, orange where the player bombed, nothing else', ...);
```

```ts
test('the minimap shows the map, moves the camera, and M hides it', ...)
  // '.minimap canvas' visible; click its centre → camera centre within 2 tiles of map centre; press m → hidden; m → visible
test('hiding the minimap is remembered after a reload', ...)
```

- [ ] **Step 2: Run → FAIL.** The modules don't exist yet.
- [ ] **Step 3: Implement**
  - **Drawing:** the panel draws `image()` scaled down, with `imageSmoothingQuality = 'high'`, plus the view box (1.5 px white) and rings (radius 4 → 10 px, fading over 1.5 s).
  - **Flashes:** at most 12. New flashes push the oldest out.
  - **Click or drag:** `camera.centerOn(tile.x, tile.y)`, with zoom unchanged.
  - **Placement:** `bottom` follows the bottom bar's height, the same way the feed does (`main.ts` sets it from the HUD's height).
- [ ] **Step 4: Run → PASS** (`npx vitest run src/client/ui/minimapGeometry.test.ts`, then `npx playwright test e2e/minimap.spec.ts`).
- [ ] **Step 5: Commit** "feat(ui): minimap with the view box, click to jump, M to hide, and danger flashes"

### Task 14: Docs, screenshots and the final checks

**Files:**
- Create: `e2e/screenshots.spec.ts`. It runs only when `SCREENSHOTS=1` and writes to `docs/screenshots/`.
- Modify: `README.md`, `docs/decisions.md`, `docs/screenshots/*`

- [ ] **Step 1: Screenshots**
  - Rename the current screenshots to `*-before.png`.
  - Run `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts` for the menu, the world map mid-game, a zoomed-in border with a front line, and the victory screen. Look at each one.
- [ ] **Step 2: README and decisions**
  - **README:** the name, the new look, sound with mute and volume, the minimap (M), the `?look=flat` switch, `npm run build:sounds`, and "Sound effects: Kenney (kenney.nl), CC0".
  - **`docs/decisions.md`:** a "Step B" section with the spec's seven decisions and every ruling from execution.
- [ ] **Step 3: The full check run.** All must pass:
  - `npm run typecheck`, `npm test`, `npm run build` and `npm run e2e`.
  - `npm run perf`: both budgets.
  - `npm run arena -- --seeds 20 --size small`: 90% / 95% / 100%.
- [ ] **Step 4: Commit** "docs: Borderline's new look and sound — README, decisions and before/after screenshots"

Push. Update pull request #2's title and description to cover Step A and Step B, or open a new pull request if #2 was merged meanwhile. Send the user the before-and-after screenshots.
