# Borderline: teams, capitals and custom rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a match rulebook (teams, capitals, six custom-rule switches) that the simulation, the bots and the page all read, with free-for-all on the default rules unchanged.

**Architecture:** `MatchRules` (shared) travels from the menu through `StartOptions` to `Game`, which derives a `Tuning` of numbers the systems read instead of `CONFIG` for those values. Teams are a `Nation.team` number with locked alliances; capitals are a non-buildable `capital` building handled by a new `capitals.ts` system; bot teamwork is a new `ai/teamwork.ts` module running on its own random stream. The page gets a rebuilt menu, a grouped leaderboard, a teammate panel, new feed lines, sounds and the capital star.

**Tech Stack:** TypeScript 6, Vite 8, Vitest 5 (Node), Playwright 1.56 (Chromium), tsx scripts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-game-modes-design.md`

## Global Constraints

- Free-for-all with `DEFAULT_RULES` plays exactly as today: `npm run arena -- --seeds 20 --size small` prints insane vs hard 18 / 2 / 0 (90%), hard vs normal 19 / 1 / 0 (95%), normal vs easy 20 / 0 / 0 (100%). Every task that touches `src/sim` ends with this check.
- Deterministic simulation: no `Math.random`, `Date` or `performance` in `src/sim`; new randomness only from new forked streams (salts below) or from streams that only run in teams or capitals games. The same seed and rules replay the same match.
- Rng salts in use: game naming 1, bots 1000 + id, personalities 7001. New: teams 7002, bot teamwork 3000 + id.
- `DEFAULT_RULES` = `{ mode: 'ffa', teams: 2, capitals: false, richStart: false, fastBuilding: false, bigArmies: false, noPlanes: false, noAlliances: false, winShare: 0.8 }`.
- Teams: 2, 3 or 4; at least 2 nations per team (`minBots = 2 × teams − 1`); at most 40 bots; the player is on team 1 and their team is never the biggest.
- Team names and base colours: Blue `0x3b82f6`, Red `0xef4444`, Green `0x22c55e`, Gold `0xeab308`; the player keeps `PLAYER_COLOR` (`0x3b82f6`).
- Team spirit: diplomat 0.9, trader 0.75, builder 0.6, aggressive 0.4, opportunist 0.25, plus a fixed per-bot offset in [−0.1, 0.1].
- Teamwork numbers (`CONFIG.teams`): ask cooldown 300 ticks; a bot's own help check at most every 100 ticks; gang-up chance spirit × 0.8; aid chance spirit × 0.6; aid when a teammate is under attack and below 25% of its troop limit; aid and asked troops up to 20% of troops above the reserve; asked gold up to 30% above the next building's cost; help attacks up to half the attack budget.
- Capitals (`CONFIG.buildings.capital`): fortress strength and reach (multiplier 2.5, radius 25); no landings or paratroopers within Chebyshev distance 3 of another nation's capital; threat warning at most every 300 ticks per nation.
- Custom numbers: rich start 5,000 start gold and all gold income × 2 (trade included); fast building ÷ 5 for buildings, warships and fighters (at least 1 tick); big armies troop growth × 2 and troop limits × 2; win share 0.6 / 0.8 / 1.
- Refusal reasons are shown in the feed as "Can’t do that: <reason>", so they are plain words: `'teammate'`, `'other team'`, `'not a teammate'`, `'too soon'`, `'bad amount'`, `'too close to a capital'`, `'not buildable'`, `'no planes'`, `'no alliances'`.
- Menu storage key `borderline.menu`, through `safeStorage()`. URL parameters: `mode=teams&teams=3&capitals=1&rich=1&fast=1&big=1&noplanes=1&noalliances=1&win=60`.
- Feed copy, exactly: "Nirenia joins your attack on Varlonia", "Fenyutra strikes back at Zanbaia for you", "Nuni sent you 4.2k troops", "Danmek says no: busy with its own war" / "Danmek says no: can’t spare any" / "Danmek says no: not now", "Your capital is under attack!", "Danmek’s capital fell to Nuni — Danmek is out", "Your capital fell to Nuni — you are out". End screen: "Team victory", "Defeat" with "Red team won". Use the typographic apostrophe (’) as the existing feed lines do.
- Speed: `npm run perf` step mean under 20 ms, also with `-- --bots 40 --teams 4 --capitals`.
- No console errors in any browser test.

## Review Focus

1. **A player knocked out in a teams match whose team wins later** gets the "Team victory" screen (their own commands are already refused while they are out). Test: Task 10 `endScreenText` cases.
2. **A capital falling at the same moment as other captures** (its owner's last other tiles, a chain where the capturer's own capital falls next): tile counts and building counts stay right, and nobody is knocked out twice. Test: Task 6 random-match bookkeeping test.
3. **Team sizes at the edges** (1 to 40 bots, 2 to 4 teams, bots-only arena games with no player): no empty team, no team of one, and the player's team is never the biggest. Test: Task 3 `teamSizes` loop.
4. **Bad rules input** (URL `win=55`, `teams=9`, `mode=foo`, broken JSON in storage): the defaults are used and nothing throws. Test: Task 1 `rulesFromParams` and `sanitizeRules`; Task 9 `loadMenuChoices`.
5. **No planes with the hotkeys and the right-click menu**: the plane buildings can't be started, and bots never try (no refusal spam). Test: Task 2 600-tick match; Task 11 browser test.

## Notes on the spec

The plan settles these points the spec leaves loose.
- Refusal reasons are plain words (see Global Constraints), not the spec's `'otherTeam'`, `'tooSoon'` and `'nearCapital'`, because the feed prints them as they are.
- `GameResult.team` is optional and set only in teams mode, so every free-for-all result stays exactly as today.
- `describeRules` names the team count ("3 teams · Capitals · …"); the spec's "Teams · Capitals" was an example.
- "Send gold / Send troops" to a teammate use the panel's deal fields "Give gold" / "Give troops", as today's Gift does (the spec's mention of the slider was wrong about today's gifts).
- `capitalThreat` also carries the capital's `tile`, for the minimap ring; `eliminated` gains `capital?: true` when a capital fall caused it, so the feed shows one line, not two.

## File Structure

**New**
- `src/shared/rules.ts` — `MatchRules`, defaults, URL and storage parsing, the label, `minBots`, buildable types.
- `src/sim/core/tuning.ts` — the numbers the rules give.
- `src/sim/core/teams.ts` — team sizes, dealing nations into teams, locked alliances, `sameTeam`.
- `src/sim/systems/teamAid.ts` — gifts and asks between teammates.
- `src/sim/systems/capitals.ts` — placing, threats, falls, landing clearance.
- `src/sim/ai/teamwork.ts` — team spirit at work: hit back, gang up, aid, answers to asks.
- `src/client/ui/menuMemory.ts` — remembered menu choices.
- `src/client/ui/endText.ts` — the end screen's words (pure).
- Tests: `src/shared/rules.test.ts`, `src/shared/colors.test.ts`, `src/sim/core/tuning.test.ts`, `src/sim/core/teams.test.ts`, `src/sim/systems/customRules.test.ts`, `src/sim/systems/teamRules.test.ts`, `src/sim/systems/teamAid.test.ts`, `src/sim/systems/capitals.test.ts`, `src/sim/ai/teamwork.test.ts`, `src/sim/ai/capitalsAi.test.ts`, `src/client/ui/menuMemory.test.ts`, `src/client/ui/endText.test.ts`, `e2e/modes.spec.ts`.

**Modified** (main ones; typecheck lists the rest)
- Shared: `types.ts` (commands, events, `capital`, `ALL_BUILDING_TYPES`, `GameResult.team`), `config.ts` (`teams`, `capitals`, `buildings.capital`, aim and AI constants), `colors.ts` (`teamColor`, `TEAM_NAMES`, `TEAM_COLORS`).
- Sim core: `game.ts`, `nation.ts`, `commands.ts`, `match.ts`.
- Sim systems: `economy.ts`, `spawn.ts`, `buildings.ts`, `combat.ts`, `attacks.ts`, `air.ts`, `naval.ts`, `diplomacy.ts`, `victory.ts`; `snapshot.ts`; `arena.ts`.
- AI: `bot.ts`, `profile.ts`, `perception.ts`, `military.ts`, `economy.ts`, `diplomacy.ts`, `air.ts`, `naval.ts`.
- Worker and protocol: `protocol.ts`, `sim.worker.ts`.
- Page: `main.ts`, `state.ts`, `testApi.ts`, `ui/menu.ts`, `ui/leaderboard.ts`, `ui/diplomacyPanel.ts`, `ui/endScreen.ts`, `ui/eventText.ts`, `ui/eventFeed.ts`, `ui/labels.ts`, `ui/hud.ts`, `ui/contextMenu.ts`, `ui/minimap.ts`, `ui/minimapGeometry.ts`, `audio/director.ts`, `render/icons.ts`, `styles.css`, `testing/fixtures.ts`.
- Scripts and docs: `scripts/arena.ts`, `scripts/perf.ts`, `README.md`, `docs/decisions.md`, `e2e/screenshots.spec.ts`, `docs/screenshots/`.

## Conventions

- **"Run → FAIL"** means `npx vitest run <files>` (or `npx playwright test <files>`) fails for the stated reason.
- **"Run → PASS"** means the same command passes, `npm run typecheck` reports 0 errors, and `npm test` is all green.
- **"Arena unchanged"** means `npm run arena -- --seeds 20 --size small` prints exactly 18/2/0, 19/1/0 and 20/0/0. A different line means default-rules behaviour changed: find out why before going on.
- **"Commit"** means `git add -A && git commit -m "<message>"` with the attribution trailer.
- Sim tests build games with `makeTestGame` (`src/sim/testing/fixtures.ts`) and commands with `applyCommand`, as the existing tests do; bot tests build a `Bot` and call `perceive`, as `diplomacyAi.test.ts` does.
- The e2e web server builds the app first, so a type error fails every browser test.

---

## Milestone 1 — The rulebook

### Task 1: The rulebook, its numbers, and the number switches

**Files:**
- Create: `src/shared/rules.ts`, `src/sim/core/tuning.ts`
- Modify: `src/sim/core/game.ts`, `src/sim/systems/economy.ts`, `src/sim/systems/spawn.ts`, `src/sim/systems/buildings.ts`, `src/sim/systems/naval.ts` (warship ticks, `payTrade`), `src/sim/systems/air.ts` (fighter ticks), `src/sim/systems/victory.ts`, `src/worker/protocol.ts`, `src/worker/sim.worker.ts`, `src/client/main.ts`, `src/client/ui/menu.ts`, `src/sim/testing/fixtures.ts`
- Test: `src/shared/rules.test.ts`, `src/sim/core/tuning.test.ts`, `src/sim/systems/customRules.test.ts`

**Interfaces:**
- Produces (`src/shared/rules.ts`):
  - `interface MatchRules { mode: 'ffa' | 'teams'; teams: 2 | 3 | 4; capitals: boolean; richStart: boolean; fastBuilding: boolean; bigArmies: boolean; noPlanes: boolean; noAlliances: boolean; winShare: 0.6 | 0.8 | 1 }`
  - `DEFAULT_RULES: MatchRules`
  - `rulesFromParams(p: URLSearchParams): MatchRules`
  - `sanitizeRules(raw: unknown): MatchRules`
  - `describeRules(r: MatchRules): string`
  - `minBots(r: MatchRules): number`
  - `PLANE_BUILDINGS: readonly BuildingType[]` = `['airport', 'antiAir', 'radar']`
  - `buildableTypes(r: MatchRules): BuildingType[]`
- Produces (`src/sim/core/tuning.ts`):
  - `interface Tuning { startGold: number; goldScale: number; troopGrowthScale: number; troopCapScale: number; buildTimeScale: number; winShare: number; planes: boolean; alliances: boolean; capitals: boolean; teams: boolean }`
  - `tuningFor(r: MatchRules): Tuning`
  - `scaledTicks(ticks: number, scale: number): number` — `Math.max(1, Math.round(ticks * scale))`
- Produces (sim): `GameSetup.rules?: MatchRules`; `Game.rules: MatchRules` and `Game.tuning: Tuning` (missing rules mean `DEFAULT_RULES`); `TestGameOptions.rules?: Partial<MatchRules>`.
- Produces (protocol): `StartOptions.rules: MatchRules`.

- [ ] **Step 1: Write the failing tests**

```ts
// rules.test.ts
it('DEFAULT_RULES: free-for-all, every switch off, win at 80%', () => {
  expect(DEFAULT_RULES).toEqual({ mode: 'ffa', teams: 2, capitals: false, richStart: false, fastBuilding: false,
    bigArmies: false, noPlanes: false, noAlliances: false, winShare: 0.8 });
});
it('rulesFromParams reads every switch', () => {
  expect(rulesFromParams(new URLSearchParams('mode=teams&teams=3&capitals=1&rich=1&fast=1&big=1&noplanes=1&noalliances=1&win=60')))
    .toEqual({ mode: 'teams', teams: 3, capitals: true, richStart: true, fastBuilding: true, bigArmies: true,
      noPlanes: true, noAlliances: true, winShare: 0.6 });
});
it('rulesFromParams keeps the default for every missing or bad value', () => {
  expect(rulesFromParams(new URLSearchParams('mode=foo&teams=9&win=55&capitals=yes'))).toEqual(DEFAULT_RULES);
});
it('sanitizeRules keeps the good fields and replaces the bad ones', () => {
  expect(sanitizeRules({ mode: 'teams', teams: 7, winShare: 1, capitals: 'x' })).toEqual({ ...DEFAULT_RULES, mode: 'teams', winShare: 1 });
  expect(sanitizeRules(null)).toEqual(DEFAULT_RULES);
  expect(sanitizeRules('junk')).toEqual(DEFAULT_RULES);
});
it('describeRules', () => {
  expect(describeRules(DEFAULT_RULES)).toBe('Free-for-all');
  expect(describeRules({ ...DEFAULT_RULES, winShare: 1 })).toBe('Free-for-all · Win at 100%');
  expect(describeRules(rulesFromParams(new URLSearchParams('mode=teams&teams=3&capitals=1&rich=1&fast=1&big=1&noplanes=1&noalliances=1&win=60'))))
    .toBe('3 teams · Capitals · Rich start · Fast building · Big armies · No planes · No alliances · Win at 60%');
});
it('minBots: 1 in free-for-all, 2 × teams − 1 in teams', () => {
  expect(minBots(DEFAULT_RULES)).toBe(1);
  expect([2, 3, 4].map((t) => minBots({ ...DEFAULT_RULES, mode: 'teams', teams: t as 2 | 3 | 4 }))).toEqual([3, 5, 7]);
});
it('buildableTypes leaves out the plane buildings with no planes', () => {
  expect(buildableTypes(DEFAULT_RULES)).toEqual(BUILDING_TYPES);
  expect(buildableTypes({ ...DEFAULT_RULES, noPlanes: true })).toEqual(BUILDING_TYPES.filter((t) => !['airport', 'antiAir', 'radar'].includes(t)));
});

// tuning.test.ts
it("the default rules give today's numbers", () => {
  expect(tuningFor(DEFAULT_RULES)).toEqual({ startGold: CONFIG.spawn.startGold, goldScale: 1, troopGrowthScale: 1, troopCapScale: 1,
    buildTimeScale: 1, winShare: CONFIG.win.landShare, planes: true, alliances: true, capitals: false, teams: false });
});
it('each switch changes its numbers', () => {
  const t = (r: Partial<MatchRules>) => tuningFor({ ...DEFAULT_RULES, ...r });
  expect(t({ richStart: true })).toMatchObject({ startGold: 5000, goldScale: 2 });
  expect(t({ fastBuilding: true }).buildTimeScale).toBe(0.2);
  expect(t({ bigArmies: true })).toMatchObject({ troopGrowthScale: 2, troopCapScale: 2 });
  expect(t({ noPlanes: true, noAlliances: true, capitals: true, mode: 'teams', winShare: 0.6 }))
    .toMatchObject({ planes: false, alliances: false, capitals: true, teams: true, winShare: 0.6 });
});
it('scaledTicks rounds and never goes below 1', () => {
  expect([scaledTicks(100, 0.2), scaledTicks(3, 0.2), scaledTicks(50, 1)]).toEqual([20, 1, 50]);
});

// customRules.test.ts
it('a game without rules uses the defaults', () => { expect(makeTestGame({ map: ['##'], nations: [{}] }).rules).toEqual(DEFAULT_RULES); });
it('rich start: a spawn gets 5,000 gold, and income and trade gold double', () => { /* spawnNation in a spawn-phase game; goldIncome(rich) === 2 × goldIncome(default) for the same nation; payTrade(rich) adds twice the gold */ });
it('fast building: a fortress finishes after 20 ticks', () => { /* build, then 19 × stepBuildings → still building; 20th → buildingDone */ });
it('fast building: warships and fighters are ready 5 times sooner', () => { /* buildWarship/buildFighter cooldown = scaledTicks(buildTicks, 0.2) */ });
it('big armies: the troop limit and growth double', () => { /* maxTroops and troopGrowth (below max) × 2 */ });
it('win at 60%: holding 60% of the land wins; win at 100%: 99% is not enough', () => { /* checkVictory with rules.winShare */ });
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run src/shared/rules.test.ts src/sim/core/tuning.test.ts src/sim/systems/customRules.test.ts`): the modules don't exist.
- [ ] **Step 3: Implement**
  - `rules.ts` as in Interfaces. URL: `mode` is `'teams'` or the default; `teams` is 2/3/4; the five switches are on only for the value `'1'`; `win` is 60/80/100. `sanitizeRules` checks each field's type and allowed values one by one.
  - `describeRules`: the parts, joined by `' · '`: `'Free-for-all'` or `` `${teams} teams` ``, then `'Capitals'`, `'Rich start'`, `'Fast building'`, `'Big armies'`, `'No planes'`, `'No alliances'` when on, then `` `Win at ${winShare × 100}%` `` unless 0.8.
  - `tuningFor`: rich start `startGold: 5000, goldScale: 2`; fast building `buildTimeScale: 0.2`; big armies both troop scales 2; everything else as in the default test.
  - Wire the numbers in where `CONFIG` gives them today: `maxTroops` × `troopCapScale` (the whole sum); `troopGrowth` below the limit × `troopGrowthScale` (the over-limit decay stays); `goldIncome` × `goldScale`; `payTrade` multiplies the gold it pays by `goldScale` before anything else; `placeSpawn` gives `game.tuning.startGold`; `build` uses `scaledTicks(CONFIG.buildings[type].buildTicks, game.tuning.buildTimeScale)`; `buildWarship` and `buildFighter` the same for their `buildTicks`; `checkVictory` uses `game.tuning.winShare`. Multiplying by 1 and `Math.round` of a whole number change nothing, which keeps the arena unchanged.
  - Protocol and page: `StartOptions.rules`; the worker passes it into the `Match` setup; `optionsFromUrl` adds `rules: rulesFromParams(p)`; the menu passes `DEFAULT_RULES` for now (Task 9 rebuilds it).
- [ ] **Step 4: Run → PASS**, then **Arena unchanged**.
- [ ] **Step 5: Commit** "feat(rules): one rulebook for the match, with rich start, fast building, big armies and the win share"

### Task 2: No planes and no alliances

**Files:**
- Modify: `src/sim/systems/buildings.ts` (`canPlace`), `src/sim/systems/air.ts` (`launchBomber`, `launchParatroopers`, `buildFighter`), `src/sim/systems/diplomacy.ts` (`createRequest`), `src/sim/ai/economy.ts` (`rankBuilds`), `src/sim/ai/diplomacy.ts` (`proposeDiplomacy`)
- Test: `src/sim/systems/customRules.test.ts`, `src/sim/ai/economyAi.test.ts`, `src/sim/ai/diplomacyAi.test.ts`

**Interfaces:**
- Consumes: `Game.tuning.planes`, `Game.tuning.alliances`, `PLANE_BUILDINGS` (Task 1).
- Produces: refusals `'no planes'` (plane buildings, bombers, paratroopers, fighters) and `'no alliances'` (alliance requests).

- [ ] **Step 1: Write the failing tests**

```ts
// customRules.test.ts
it("no planes: airports, anti-air guns and radar stations can't be built; a factory can", () => {
  // for each of PLANE_BUILDINGS: canPlace(...) → { ok: false, reason: 'no planes' }; factory → { ok: true }
});
it('no planes: no bombers, paratroopers or fighters, even with an airport', () => {
  // add a finished airport with game.buildings.add(...) and its count; launchBomber / launchParatroopers / buildFighter → reason 'no planes'
});
it('no alliances: alliance requests are refused; peace still works', () => {
  // createRequest(g, 'alliance', 1, 2) → { ok: false, reason: 'no alliances' }; peace between two nations at war → ok
});
it('a 600-tick match with no planes and no alliances has no plane units and no refusals for either', () => {
  // Match on generateRandomMap(3, 'small'), 8 hard bots, rules { noPlanes: true, noAlliances: true }, spawnTicks 1;
  // collect every event: no 'rejected' with reason 'no planes' or 'no alliances'; no unit of a plane type ever exists
});
// economyAi.test.ts
it('with no planes, bots never rank the plane buildings', () => { /* a scenario where rankBuilds values an airport today; with noPlanes none of PLANE_BUILDINGS appears */ });
// diplomacyAi.test.ts
it('with no alliances, bots propose none', () => { /* the existing "proposes an alliance" scenario with rules { noAlliances: true } → no proposeAlliance */ });
```

- [ ] **Step 2: Run → FAIL**: nothing refuses yet.
- [ ] **Step 3: Implement** the refusals (`canPlace` checks `'no planes'` right after `'not land'`; the air commands first thing; `createRequest` for `'alliance'` right after the counterpart check). `rankBuilds` skips `PLANE_BUILDINGS` when `!game.tuning.planes`; `proposeDiplomacy` makes no alliance proposal when `!game.tuning.alliances`. The air AI needs nothing more: without airports it has nothing to fly.
- [ ] **Step 4: Run → PASS**, then **Arena unchanged**.
- [ ] **Step 5: Commit** "feat(rules): no planes and no alliances"

---

## Milestone 2 — Teams in the simulation

### Task 3: Teams: who's on which team, colours, locked alliances and team wins

**Files:**
- Create: `src/sim/core/teams.ts`
- Modify: `src/sim/core/nation.ts`, `src/sim/core/game.ts`, `src/shared/colors.ts`, `src/shared/types.ts` (`GameResult.team?`), `src/sim/systems/diplomacy.ts`, `src/sim/systems/victory.ts`, `src/sim/snapshot.ts`, `src/worker/protocol.ts`, `src/sim/ai/diplomacy.ts`, `src/sim/testing/fixtures.ts`, `src/client/testing/fixtures.ts` and the tests that build an `InitPayload` (typecheck lists them)
- Test: `src/sim/core/teams.test.ts`, `src/shared/colors.test.ts`, `src/sim/systems/teamRules.test.ts`, `src/sim/systems/victory.test.ts`, `src/sim/snapshot.test.ts`, `src/sim/ai/diplomacyAi.test.ts`

**Interfaces:**
- Consumes: `Game.rules` (Task 1), `minBots` (Task 1).
- Produces:
  - `Nation.team: number` — 1–4 in teams mode, 0 in free-for-all (`createNation` sets 0).
  - `teamSizes(total: number, teams: number, withPlayer: boolean): number[]` — index 0 is team 1.
  - `assignTeams(playerId: NationId, botIds: NationId[], teams: number, rng: Rng): Map<NationId, number>`
  - `sameTeam(game: Game, a: NationId, b: NationId): boolean` — two different nations with the same team > 0.
  - `lockTeams(game: Game): void` — every same-team pair allied, without events.
  - `TEAM_RNG_SALT = 7002`
  - `GameSetup.bots[i].team?: number` — explicit teams (the arena); when any bot has one, nobody is shuffled and the player (if any) is on team 1.
  - `teamColor(team: number, index: number, isPlayer: boolean): number`, `TEAM_NAMES = ['Blue', 'Red', 'Green', 'Gold']`, `TEAM_COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xeab308]` (`src/shared/colors.ts`).
  - `GameResult.team?: number` — the winning team, only in teams mode.
  - `InitPayload.rules: MatchRules`; `InitPayload.nations[i].team: number`.
  - `TestGameOptions.teams?: number[]` — the team of nation i + 1; `makeTestGame` then calls `lockTeams`.
  - Refusals: `'teammate'` (breaking a teammate alliance; an embargo on a teammate), `'other team'` (alliance requests across teams).

- [ ] **Step 1: Write the failing tests**

```ts
// teams.test.ts
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
it('with the bots raised to minBots, every team has at least 2 nations', () => {
  for (let bots = 1; bots <= 40; bots++) for (const teams of [2, 3, 4] as const) {
    const n = Math.min(40, Math.max(minBots({ ...DEFAULT_RULES, mode: 'teams', teams }), bots));
    expect(Math.min(...teamSizes(n + 1, teams, true))).toBeGreaterThanOrEqual(2);
  }
});
it('assignTeams: the player on team 1, sizes from teamSizes, the same for the same seed', () => { ... });
it('a teams game: teammates start allied, others neutral, colours from the team families', () => {
  // Game with a player and 5 bots, rules { mode: 'teams', teams: 2 }: nations[1].team === 1, nations[1].color === PLAYER_COLOR,
  // relations allied exactly within teams; a second Game with the same seed has the same teams
});
// colors.test.ts
it('teamColor keeps each family in its hue range and gives 20 different shades', () => {
  // hue ranges: Blue 195–240°, Red 340–20° (wrapping), Green 95–155°, Gold 35–55°; 20 indexes → 20 different colours
});
it('the player keeps the player colour', () => { expect(teamColor(1, 0, true)).toBe(PLAYER_COLOR); });
// teamRules.test.ts (makeTestGame with teams: [1, 1, 2])
it('attacks on a teammate are refused as allied', ...);
it('breaking a teammate alliance is refused: teammate', ...);
it('an embargo on a teammate is refused: teammate; lifting one is fine', ...);
it('alliances across teams are refused: other team', ...);
it('teammates can trade', () => { expect(canTrade(g, 1, 2)).toBe(true); });
// victory.test.ts
it('teams: a team holding the win share together wins, its knocked-out members included', () => {
  // teams [1, 1, 2]; nation 2 dead; nation 1 holds 80% → { winners: [1, 2], reason: 'landShare', team: 1 }
});
it('teams: the last team with living members wins', () => { /* → reason 'lastStanding', team set, all its members */ });
it('teams: no winner while two teams have living members below the share', ...);
it('free-for-all results have no team field', () => { /* the existing toEqual expectations keep passing */ });
// snapshot.test.ts
it("buildInit carries the rules and each nation's team", ...);
// diplomacyAi.test.ts
it('bots never betray a teammate', () => { /* a scenario where considerBetrayal returns the ally today; as teammates → null */ });
it('in teams mode bots propose no alliances', ...);
```

- [ ] **Step 2: Run → FAIL**: no teams yet.
- [ ] **Step 3: Implement**
  - `teamSizes`: `base = floor(total / teams)`, `extra = total % teams`. With the player, team 1 gets `base` and the first `extra` of the other teams get one more. Without a player, the first `extra` teams get one more.
  - `assignTeams`: shuffle the bot ids (Fisher–Yates on `rng`), fill team 1 with the player and then the bots, then the other teams in order.
  - `Game` constructor in teams mode: teams from explicit `bots[i].team` when given, else `assignTeams` on `this.rng.fork(TEAM_RNG_SALT)` (a fork, so the game's own stream is untouched); colours `teamColor(team, indexInTeam, isPlayer)`; then `lockTeams`. Free-for-all keeps today's colours and draws no extra random numbers.
  - `teamColor`: build each family's palette once, farthest-point within the family's hue range (lightness 0.36–0.70, saturation 0.55–0.85), the same way `buildBotPalette` does; index wraps.
  - Refusals in `breakAlliance`, `setEmbargo` (only when switching on) and `createRequest` (`'alliance'` when both have teams and they differ).
  - `checkVictory` in teams mode: sum the tiles of each team's living members; a team at or above `winShare × landCount` wins (most tiles, then lowest team number); else, if only one team has living members, it wins with `'lastStanding'`. The winners are every nation of that team in id order.
  - Snapshot: `rules` and `team`. Bots: `considerBetrayal` skips teammates; `proposeDiplomacy` makes no alliance proposals in teams mode.
- [ ] **Step 4: Run → PASS**, then **Arena unchanged**.
- [ ] **Step 5: Commit** "feat(teams): teams with locked alliances, team colours and team wins"

### Task 4: Gifts and asks between teammates

**Files:**
- Create: `src/sim/systems/teamAid.ts`
- Modify: `src/shared/types.ts`, `src/shared/config.ts` (`teams`), `src/sim/core/commands.ts`, `src/sim/core/game.ts` (`asks`), `src/sim/systems/diplomacy.ts` (`respond` reason, joint-attack cooldown), `src/sim/snapshot.ts`, `src/worker/protocol.ts`, `src/client/state.ts`, `src/client/ui/eventText.ts`
- Test: `src/sim/systems/teamAid.test.ts`, `src/client/ui/eventText.test.ts`

**Interfaces:**
- Consumes: `sameTeam` (Task 3).
- Produces:
  - Commands `{ type: 'sendAid'; nation; to; gold: number; troops: number }` and `{ type: 'askAid'; nation; to; resource: 'troops' | 'gold' }`; `respond` gains `reason?: AidRefusal`.
  - `type AidRefusal = 'busy' | 'cantSpare' | 'notNow'`
  - `DiplomacyRequest.kind` gains `'aid'`, with `resource?: 'troops' | 'gold'`.
  - Events: `{ type: 'aidSent'; from; to; gold: number; troops: number }`; `requestResolved` gains `reason?: AidRefusal`.
  - `CONFIG.teams = { askCooldownTicks: 300, helpCheckTicks: 100, joinChance: 0.8, aidChance: 0.6, aidLowTroops: 0.25, aidTroopShare: 0.2, aidGoldShare: 0.3, helpBudgetShare: 0.5, busyIncomingShare: 0.3, spiritJitter: 0.1, jointEase: 0.5 }` (the later keys are used by Task 5).
  - `sendAid(game, from, to, gold, troops): CommandResult`, `askAid(game, from, to, resource): CommandResult`, `askReadyIn(game, from, to): number`.
  - `NationSnap.askReadyIn: number` — ticks until the player may ask this nation again (0 when ready, and for non-teammates).

- [ ] **Step 1: Write the failing tests**

```ts
// teamAid.test.ts (makeTestGame, teams [1, 1, 2])
it('sendAid moves gold and troops to a teammate at once and emits aidSent', ...);
it('sendAid is refused: not a teammate, bad amount (negative, not finite, both 0), not enough gold or troops', ...);
it('askAid opens an aid request; asking the same teammate again within 300 ticks is refused: too soon', () => {
  // ask at tick 0 → ok, request { kind: 'aid', resource: 'troops' }; tick 299 → 'too soon'; tick 300 → ok
});
it('joint-attack requests between teammates follow the same 300-tick rule, and work with no alliances', ...);
it('respond passes its reason to requestResolved', () => { /* respond(..., false, 'busy') → requestResolved.reason 'busy' */ });
it("askReadyIn counts down for the player's teammates and is 0 for others", ...);
// eventText.test.ts
it('aid lines', () => {
  // aidSent to me 4200 troops → 'Nuni sent you 4.2k troops'; gold only → 'Nuni sent you 1.2k gold';
  // both → 'Nuni sent you 4.2k troops and 1.2k gold'; from me → 'You sent Nuni 1k gold';
  // requestResolved kind 'aid' from me, declined: busy → 'Danmek says no: busy with its own war',
  // cantSpare → 'Danmek says no: can’t spare any', notNow → 'Danmek says no: not now'; accepted → null (the aidSent line says it)
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `teamAid.ts`. The last ask tick per (asker, teammate) lives in `game.asks: Map<number, number>` keyed `from × nations.length + to`; `askAid` and teammate `requestJointAttack` check and set it. Accepting an aid request changes nothing by itself (the bot sends the aid with `sendAid`), like a joint attack today. The client's `concernsPlayer` takes `aidSent` when `from` or `to` is the player; `REQUEST_LABELS.aid = 'ask for help'`.
- [ ] **Step 4: Run → PASS**, then **Arena unchanged**.
- [ ] **Step 5: Commit** "feat(teams): gifts and asks between teammates"

### Task 5: Teammate bots

**Files:**
- Create: `src/sim/ai/teamwork.ts`
- Modify: `src/sim/ai/profile.ts`, `src/sim/ai/bot.ts`, `src/sim/ai/diplomacy.ts` (joint attacks from teammates), `src/shared/types.ts` (attack `support`), `src/sim/systems/attacks.ts`, `src/client/state.ts`, `src/client/ui/eventText.ts`
- Test: `src/sim/ai/teamwork.test.ts`, `src/client/ui/eventText.test.ts`

**Interfaces:**
- Consumes: `CONFIG.teams`, `sendAid` / `askAid` / `AidRefusal` (Task 4), `sameTeam` (Task 3), `reserveNeeded` / `attackBudget` / `rankBuilds` (existing).
- Produces:
  - `PersonalityWeights.teamSpirit: number`
  - `Bot.teamSpirit: number` (writable, so tests can set it) and `Bot.teamRng: Rng` = `new Rng(seed).fork(3000 + id)`; the offset in [−0.1, 0.1] comes from `teamRng`, so the bots' own streams are untouched.
  - `BotMemory.lastHelpCheck: number`
  - `teamHelp(game: Game, p: Perception, bot: Bot): Command[]` — at most one command.
  - `answerAid(game: Game, p: Perception, bot: Bot, req: DiplomacyRequest): Command[]` — `[sendAid, respond]` for a yes, `[respond]` with a reason for a no.
  - The attack command gains `support?: { ally: NationId; kind: 'join' | 'defend' }`, echoed in `attackStarted.support` (dropped when `ally` isn't a teammate).

- [ ] **Step 1: Write the failing tests**

```ts
// teamwork.test.ts (makeTestGame with teams; Bot built as in diplomacyAi.test.ts)
it('team spirit follows the personality, within ±0.1 per bot', ...);
it('hit back: the bot attacks whoever attacks its teammate, when the roll succeeds', () => {
  // teammate 2 under attack by 3, which borders bot 1; bot.teamSpirit = 1 → one attack on 3 with support { ally: 2, kind: 'defend' }
});
it('no help when the rolls fail', () => { /* teamSpirit 0 → [] */ });
it("gang up: the bot joins its teammate's attack on a nation next to it", () => { /* teamSpirit 1.25 (so 1.25 × 0.8 ≥ 1) → support { kind: 'join' } */ });
it('aid: a teammate under attack below 25% of its limit gets up to 20% of the troops above the reserve', ...);
it('the bot helps on its own at most once every 100 ticks', ...);
it('answers to asks: yes sends troops or gold; no says busy, cantSpare or notNow', ...);
it("answers to asks don't count toward the help limit", ...);
it('free-for-all bots never run teamwork', () => { /* teamHelp in a free-for-all game → [] */ });
it('a teams match replays identically from the same seed', () => {
  // two Matches: generateRandomMap(5, 'small'), 8 bots, rules { mode: 'teams', teams: 2 }, spawnTicks 1, 400 steps each;
  // the owner arrays and the JSON of every event are equal
});
// eventText.test.ts
it('teamwork lines', () => {
  // attackStarted { attacker: Nirenia, target: Varlonia, support: { ally: me, kind: 'join' } } → 'Nirenia joins your attack on Varlonia'
  // defend → 'Fenyutra strikes back at Zanbaia for you'; support for someone else → null
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
  - `teamHelp`, only in teams mode and when `game.tick − lastHelpCheck ≥ helpCheckTicks` (it sets `lastHelpCheck` on every check):
    1. **Hit back:** for each living teammate under attack by a nation that is our non-allied neighbour, roll `teamSpirit`; on success, attack it with `helpBudgetShare` of `attackBudget`.
    2. **Gang up:** else, for each teammate attacking a non-allied neighbour of ours, roll `teamSpirit × joinChance`.
    3. **Aid:** else, for each teammate under attack whose troops are below `aidLowTroops` of its troop limit, roll `teamSpirit × aidChance`; send `floor(min(aidTroopShare × troops, troops − reserve))` when that is at least 1.
    The first success acts. All rolls come from `teamRng`, teammates in id order.
  - `answerAid`: no with `'busy'` when we are at war and `incoming > busyIncomingShare × troops`; no with `'cantSpare'` when nothing is above the reserve (troops) or above the best-ranked building's cost (gold); no with `'notNow'` when the roll under `teamSpirit` fails; else yes with up to `aidTroopShare` of the troops above the reserve, or `aidGoldShare` of the gold above that cost.
  - In `bot.decide`: aid requests go to `answerAid` (`evaluateRequest` gets `case 'aid': return false`, never reached, so its switch stays complete). A joint attack asked by a teammate needs only `jointAttackShare × (1 − jointEase × teamSpirit)` of the best score. `teamHelp` runs after the bot's own attacks, with what the budget has left.
  - The client's `concernsPlayer` also takes an `attackStarted` whose `support.ally` is the player.
- [ ] **Step 4: Run → PASS**, then **Arena unchanged**.
- [ ] **Step 5: Commit** "feat(bots): teammates hit back, gang up, send aid and answer asks, by team spirit"

---

## Milestone 3 — Capitals in the simulation

### Task 6: Capitals

**Files:**
- Create: `src/sim/systems/capitals.ts`
- Modify: `src/shared/types.ts`, `src/shared/config.ts`, `src/sim/core/nation.ts`, `src/sim/core/game.ts`, `src/sim/systems/spawn.ts`, `src/sim/systems/buildings.ts`, `src/sim/systems/combat.ts`, `src/sim/systems/attacks.ts`, `src/sim/systems/air.ts`, `src/sim/systems/naval.ts`, `src/sim/ai/economy.ts` (benefit table), `src/client/ui/labels.ts`, `src/client/state.ts`, `src/client/ui/eventText.ts`, `src/client/ui/eventFeed.ts` (`isAlarm`)
- Test: `src/sim/systems/capitals.test.ts`, `src/client/ui/eventText.test.ts`

**Interfaces:**
- Consumes: `Game.tuning.capitals` (Task 1).
- Produces:
  - `BuildingType` gains `'capital'`; `BUILDING_TYPES` stays the 11 buildable types; `ALL_BUILDING_TYPES = [...BUILDING_TYPES, 'capital']` for building counts.
  - `CONFIG.buildings.capital = { cost: 0, buildTicks: 0, radius: 25, multiplier: 2.5 }`; `CONFIG.capitals = { landingClearance: 3, threatCooldownTicks: 300 }`; `CONFIG.combat.aimWeight = 3`, `CONFIG.combat.aimRange = 50`.
  - `capitalOf(game, nation): Building | undefined`; `placeCapital(game, nation, tile): void`; `nearEnemyCapital(game, nation, tile): boolean`; `fallCapital(game, from, to): void`; `noteCapitalThreat(game, tile, from, to): void` (an `onOwnerChange` hook).
  - Events: `{ type: 'capitalThreat'; nation; tile }` and `{ type: 'capitalFell'; nation; by; tiles: number }`; `eliminated` gains `capital?: true`.
  - `Attack.aim: TileIndex | null`; `startAttack(game, attacker, target, troops, seedTile?, seedOnly = false, aim: TileIndex | null = null)`.
  - Refusals `'not buildable'` and `'too close to a capital'`.
  - Labels: `BUILDING_LABELS.capital = 'Capital'`, `BUILDING_HINTS.capital = 'Lose it and you are out'`.

- [ ] **Step 1: Write the failing tests**

```ts
// capitals.test.ts
it('with capitals on, a spawn places the capital and moving the spawn moves it', ...);
it('random starts at the end of the spawn phase get a capital too; without capitals there is none', ...);
it('the capital defends like a fortress: 2.5 within 25 tiles, 1 beyond', ...);
it("capitals can't be built (not buildable), and bombs leave them standing", ...);
it('paratroopers and boat landings within 3 tiles of an enemy capital are refused: too close to a capital; 4 tiles away is fine', ...);
it('taking the capital knocks the owner out: all its land and buildings go to the capturer', () => {
  // events of that tick: one capitalFell { nation, by, tiles }, then one eliminated { nation, by, capital: true }, no buildingCaptured;
  // every former tile is the capturer's; the buildings and their active counts moved; the capital is gone; the loser's units are gone
});
it('nobody is knocked out twice when the capital is their last tile', ...);
it('an enemy taking a tile within 25 of a capital warns its owner, at most once every 300 ticks', ...);
it('with capitals on, an aimed attack reaches its aim sooner than the same attack unaimed', () => {
  // a long strip: a on the left, b on the right; attack aimed at b's far end; count the ticks until that tile is a's
});
it('a random capitals match keeps its books', () => {
  // Match: generateRandomMap(7, 'small'), 8 hard bots, rules { capitals: true }, spawnTicks 1, 1500 steps:
  // each nation's tiles equals its count in owner; buildingCounts equal the finished buildings in the store;
  // at most one eliminated event per nation; at most one capital per nation; no capital owned by a dead nation
});
// eventText.test.ts
it('capital lines', () => {
  // capitalThreat for me → 'Your capital is under attack!' (an alarm line); capitalFell → 'Danmek’s capital fell to Nuni — Danmek is out';
  // mine → 'Your capital fell to Nuni — you are out'; eliminated with capital → null
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
  - `placeSpawn` calls `placeCapital` when `tuning.capitals`: it adds a finished capital (`ticksLeft: 0`, active count +1) or moves the existing one to the new tile.
  - `canPlace` refuses `'capital'` with `'not buildable'`. `bomb` already destroys only `BUILDING_TYPES`, so capitals survive. `DEFENSE_TYPES` includes `'capital'`. Building counts go over `ALL_BUILDING_TYPES`. `rankBuilds`'s benefit table gets `capital: 0`.
  - `launchBoat` and `launchParatroopers` refuse when `nearEnemyCapital` (another nation's capital within Chebyshev `landingClearance`).
  - `onTileCaptured` returns at once when the building already belongs to `to`; when the building on the tile is a capital and `to ≠ 0`, it calls `fallCapital` instead of transferring it. `fallCapital` removes the capital; moves every other building of `from` to `to` (active counts too); `setOwner`s every tile of `from` to `to` (scanning `owner`; the hook finds those buildings already `to`'s and does nothing); then knocks `from` out as `captureTile` does (alive false, its attacks and units removed); emits `capitalFell` and then `eliminated { capital: true }`.
  - `captureTile` knocks a nation out only while it is still alive.
  - `noteCapitalThreat` (hooked in the `Game` constructor when capitals are on): when a nation loses a tile to another nation within `capital.radius` of its capital, emit `capitalThreat { nation, tile: capital tile }` unless one went out in the last `threatCooldownTicks` (`game.lastThreat`).
  - **Aim:** `attackCommand` passes `aim = tuning.capitals ? cmd.tile : null`; joining an existing attack updates its aim. `pushFrontier` adds `bonus = aim === null ? 0 : aimWeight × max(0, 1 − distance(tile, aim) / aimRange)`. A queued tile is queued again only when `owned + bonus` exceeds its queued priority, and the priority is `owned + bonus + jitter`. With no aim, both are exactly today's, the same random draws included.
  - Client: the capital lines; `isAlarm` is true for the player's `capitalThreat` and `capitalFell`; `concernsPlayer` takes `capitalThreat` for the player and every `capitalFell`.
- [ ] **Step 4: Run → PASS**, then **Arena unchanged**.
- [ ] **Step 5: Commit** "feat(capitals): capitals that defend like fortresses and hand everything over when they fall"

### Task 7: Capitals in the bots

**Files:**
- Modify: `src/sim/ai/perception.ts`, `src/sim/ai/military.ts`, `src/sim/ai/economy.ts`, `src/sim/ai/naval.ts`, `src/sim/ai/air.ts`, `src/shared/config.ts` (`ai`)
- Test: `src/sim/ai/capitalsAi.test.ts`

**Interfaces:**
- Consumes: `capitalOf`, `nearEnemyCapital` (Task 6).
- Produces:
  - `Perception.capitalFront: number` — the distance from my capital to my nearest border tile touching a non-allied nation; `Infinity` without capitals or without a capital.
  - `NeighborInfo.capitalDistance: number` — the distance from my nearest border tile to that neighbour's capital; `Infinity` without one.
  - `CONFIG.ai` gains `capitalReserve: 1.5`, `capitalDefenseValue: 0.5`, `capitalLandShare: 0.5`, `capitalReach: 40`.

- [ ] **Step 1: Write the failing tests**

```ts
// capitalsAi.test.ts
it("with an enemy front within the capital's reach, the reserve is 1.5 times bigger", ...);
it('without a defence near its capital, a bot values a defense post and places it at the spot nearest the capital', ...);
it("a reachable enemy capital adds half of that neighbour's land to the gain", () => { /* nationScore with vs without capitals */ });
it('going for a capital, the attack command aims at the capital tile', ...);
it('bots never pick a landing or a paratrooper drop within 3 tiles of an enemy capital', ...);
it('without capitals nothing changes: capitalFront and capitalDistance are Infinity, scores as before', ...);
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
  - `reserveNeeded` × `capitalReserve` when `capitalFront ≤ capital.radius`.
  - `rankBuilds`: when capitals are on and no own defense post or fortress stands within `capital.radius` of the capital, the defense post's benefit is at least `capitalDefenseValue × buildHorizonTicks × weights.defense`; `findPlacement` then uses `nearestPlaceable(…, capital tile)`.
  - `nationScore`: `gain += capitalLandShare × n.tiles` when `n.capitalDistance ≤ capitalReach`.
  - `attackOn` uses the target's capital tile as the command tile when it is within `capitalReach`, so the attack aims there.
  - `chooseInvasion` and `chooseParadrop` skip tiles where `nearEnemyCapital` is true.
- [ ] **Step 4: Run → PASS**, then **Arena unchanged**.
- [ ] **Step 5: Commit** "feat(bots): bots guard their capital and go for enemy capitals"

---

## Milestone 4 — Checks

### Task 8: Arena and speed checks for teams and capitals

**Files:**
- Modify: `src/sim/arena.ts`, `scripts/arena.ts`, `scripts/perf.ts`, `src/shared/config.ts` (only when tuning is needed)
- Test: `src/sim/arena.test.ts`

**Interfaces:**
- Consumes: `GameSetup.bots[i].team` (Task 3), `MatchRules`.
- Produces:
  - `ArenaSpec.rules?: MatchRules`; in teams mode each `teams[i]` group becomes team `i + 1`.
  - `ArenaResult.timedOut: boolean` — the match hit `maxTicks` with no result.
  - `HeadToHead.timeouts: number`; `headToHead(a, b, seeds, size, perTeam, maxTicks, rules?)`.
  - `scripts/arena.ts`: `--mode teams` runs hard against easy as two teams of `--per-team` (target: hard wins ≥ 70%); `--capitals` runs the three pairs without and with capitals and checks that the time-outs with capitals are at most half of those without.
  - `scripts/perf.ts`: `--teams N` and `--capitals`.

- [ ] **Step 1: Write the failing tests**

```ts
// arena.test.ts
it('a teams match credits the winning team: every winner is from one team', () => { /* runMatch with rules { mode: 'teams', teams: 2 } */ });
it('timedOut is true when the match hits maxTicks without a result', () => { /* maxTicks 50 → timedOut true */ });
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**, then run the checks:
  - `npm run arena -- --seeds 20 --size small` → **Arena unchanged**.
  - `npm run arena -- --mode teams --seeds 20 --size small` → the hard team wins at least 70%.
  - `npm run arena -- --capitals --seeds 20 --size small` → today's time-outs without capitals are 0 / 0 / 10 (of 20, measured while planning); with capitals: 0, 0 and at most 5.
  - `npm run perf` and `npm run perf -- --bots 40 --teams 4 --capitals` → step mean under 20 ms.
  - If a check misses, tune the `CONFIG.teams` or capital AI numbers (never the default-rules code paths), record each change as a ruling, and re-run all four.
- [ ] **Step 4: Run → PASS** (`npx vitest run src/sim/arena.test.ts`, then `npm test`).
- [ ] **Step 5: Commit** "test(arena): team and capital checks, and the perf run with teams and capitals"

---

## Milestone 5 — The page

### Task 9: The menu

**Files:**
- Create: `src/client/ui/menuMemory.ts`
- Modify: `src/client/ui/menu.ts`, `src/client/main.ts`, `src/worker/sim.worker.ts`, `src/client/styles.css`, `e2e/basic.spec.ts` (if the menu test needs it)
- Test: `src/client/ui/menuMemory.test.ts`, `e2e/modes.spec.ts`

**Interfaces:**
- Consumes: `MatchRules`, `DEFAULT_RULES`, `sanitizeRules`, `minBots` (Task 1); `safeStorage`, `KeyValue` (`src/client/storage.ts`); `createSegmented` (existing).
- Produces:
  - `interface MenuChoices { map: 'world' | 'random'; size: MapSize; bots: number; difficulty: Difficulty; name: string; rules: MatchRules }`
  - `MENU_KEY = 'borderline.menu'`, `DEFAULT_CHOICES: MenuChoices` (world, medium, 12, normal, 'You', `DEFAULT_RULES`)
  - `loadMenuChoices(storage: KeyValue): MenuChoices`, `saveMenuChoices(storage: KeyValue, c: MenuChoices): void`
  - `createMenu(onPlay, debug, storage: KeyValue)`

- [ ] **Step 1: Write the failing tests**

```ts
// menuMemory.test.ts
it('nothing saved → the defaults', ...);
it('what is saved comes back', ...);
it('broken JSON → the defaults; bad fields → their defaults, good ones kept; bots kept within 4–40', ...);
// e2e/modes.spec.ts
test('the menu sets up teams, capitals and custom rules, and remembers them after a reload', async ({ page }) => {
  // /game/?test=1: Mode Teams, Teams 3, Capitals On, open Custom rules, tick Rich start, Win at 60% → Play;
  // window.__test.state.init.rules toEqual { ...DEFAULT_RULES, mode: 'teams', teams: 3, capitals: true, richStart: true, winShare: 0.6 };
  // reload /game/?test=1 → the same choices are selected
});
test('too few bots for the teams: the menu says how many the game will use', async ({ page }) => {
  // bots 4 and Teams 4 → text '4 teams need at least 7 bots — the game will use 7'
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
  - New rows in the existing style: **Mode** (Free-for-all / Teams); **Teams** (2 / 3 / 4, hidden unless Teams); **Capitals** (Off / On); a `<details class="custom-rules">` with summary "Custom rules" holding five checkboxes styled as switches (Rich start, Fast building, Big armies, No planes, No alliances) and **Win at** (60% / 80% / 100%).
  - The note under the bots field shows only while the bot count is below `minBots`.
  - `createMenu` starts from `loadMenuChoices` and saves on Play. The seed stays random each time.
  - `main.ts` passes `safeStorage()`; `optionsFromUrl` raises `bots` to `minBots(rules)`; the worker does the same (capped at 40).
- [ ] **Step 4: Run → PASS** (unit, then `npx playwright test e2e/modes.spec.ts e2e/basic.spec.ts`).
- [ ] **Step 5: Commit** "feat(menu): mode, teams, capitals and custom rules on the menu, remembered"

### Task 10: Teams on the page

**Files:**
- Create: `src/client/ui/endText.ts`
- Modify: `src/client/ui/leaderboard.ts`, `src/client/ui/diplomacyPanel.ts`, `src/client/ui/endScreen.ts`, `src/client/main.ts`, `src/client/styles.css`, `src/client/testApi.ts`
- Test: `src/client/ui/leaderboard.test.ts`, `src/client/ui/diplomacyPanel.test.ts`, `src/client/ui/endText.test.ts`, `e2e/modes.spec.ts`

**Interfaces:**
- Consumes: `InitPayload.rules` and `nations[].team` (Task 3), `NationSnap.askReadyIn` and the commands of Task 4, `describeRules`, `TEAM_NAMES`, `TEAM_COLORS`.
- Produces:
  - `interface TeamRow { team: number; name: string; color: number; share: number; members: NationSnap[] }`
  - `teamRows(nations: NationSnap[], init: InitPayload, landCount: number, perTeam = 4): TeamRow[]` — teams by land, biggest first; members biggest first, living before knocked out, at most `perTeam` plus the player.
  - `teammateActions(askReadyIn: number): { label: string; disabled: boolean }[]` — "Send gold", "Send troops", "Ask for troops", "Ask for gold"; while waiting, the asks are disabled and show the seconds left, `Math.ceil(askReadyIn / 10)`, e.g. "Ask for troops (12s)".
  - `relationActions(relation, embargoed, teamsMode = false)` — no "Propose alliance" in teams mode; today's calls are unchanged.
  - `TestApi.openDiplomacy(id: NationId): void` — opens the diplomacy panel on a nation (the test hooks get the panel).
  - `endScreenText(result: GameResult | null, me: NationId, defeated: boolean, teamOf: (id: NationId) => number): { title: string; subtitle: string | null; victory: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
// leaderboard.test.ts
it('teamRows groups by team with total land shares, the player always listed, knocked-out members last', ...);
// diplomacyPanel.test.ts
it('teammateActions: the four teammate buttons; the asks wait out the cooldown', () => {
  expect(teammateActions(0).map((a) => a.label)).toEqual(['Send gold', 'Send troops', 'Ask for troops', 'Ask for gold']);
  expect(teammateActions(120).slice(2)).toEqual([{ label: 'Ask for troops (12s)', disabled: true }, { label: 'Ask for gold (12s)', disabled: true }]);
});
it('relationActions offers no alliance in teams mode', ...);
// endText.test.ts
it('end screen words', () => {
  // team win including me → { title: 'Team victory', subtitle: null, victory: true }
  // team 2 won → { title: 'Defeat', subtitle: 'Red team won', victory: false }
  // me knocked out earlier, then my team won → 'Team victory'
  // free-for-all: 'Victory' / 'Alliance victory' / 'Defeat', as today
});
// e2e/modes.spec.ts
test('a teams match: team colours, the grouped leaderboard and the rules label; a teammate answers an ask', async ({ page }) => {
  // /game/?autostart=1&test=1&map=random&size=small&seed=7&bots=5&difficulty=easy&mode=teams&teams=2: spawn, wait for playing;
  // two .team-header rows; .rules-label reads '2 teams'; openDiplomacy(a teammate's id); 'Ask for troops' →
  // within 15 s a feed line contains 'sent you' or 'says no'; no console errors
});
test('the Team victory screen', async ({ page }) => { /* forceResult({ winners: team 1 ids, reason: 'landShare', team: 1 }) → 'Team victory' */ });
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**
  - `Leaderboard` in teams mode draws a `.team-header` row per team (swatch in `TEAM_COLORS`, `TEAM_NAMES` name, share), then its member rows; free-for-all is unchanged. A `.rules-label` line with `describeRules(init.rules)` sits at the top of the leaderboard panel.
  - `DiplomacyPanel` on a teammate: badge "Teammate", `teammateActions`; "Send gold" / "Send troops" send `sendAid` with the form's "Give gold" / "Give troops" amount; the asks send `askAid`; "Ask to attack" stays (teammates are allied).
  - `EndScreen` uses `endScreenText` and adds "Your team's land" to the stats in teams mode.
- [ ] **Step 4: Run → PASS** (unit, then `npx playwright test e2e/modes.spec.ts`).
- [ ] **Step 5: Commit** "feat(teams): grouped leaderboard, teammate panel, team end screen and the rules label"

### Task 11: Capitals and the build bar on the page

**Files:**
- Modify: `src/client/render/icons.ts`, `src/client/ui/minimap.ts`, `src/client/ui/minimapGeometry.ts`, `src/client/audio/director.ts`, `src/client/ui/hud.ts`, `src/client/ui/contextMenu.ts`, `src/client/testApi.ts`, `src/client/main.ts`
- Test: `src/client/audio/director.test.ts`, `src/client/ui/minimapGeometry.test.ts`, `src/client/ui/contextMenu.test.ts`, `e2e/modes.spec.ts`

**Interfaces:**
- Consumes: the capital building and events (Task 6), `buildableTypes` (Task 1).
- Produces:
  - `drawBuildingIcon` draws `'capital'` as a five-pointed star.
  - `flashesFor` adds a danger flash at `capitalThreat.tile` for the player.
  - `Minimap` marks the player's capital with a small star; `TestApi.minimap()` gains `capital: boolean`.
  - `SoundDirector`: the player's `capitalThreat` → `'warning'`; `capitalFell` by the player → `'knockout'`.
  - `new Hud(state, onBuild, playerColor, types: readonly BuildingType[])` makes buttons only for `types`; the right-click build menu lists `buildableTypes(init.rules)`.
  - `TestApi.replayEvents(events: GameEvent[]): void` — runs events through the page's normal update path (the last update with these events and no tile changes).

- [ ] **Step 1: Write the failing tests**

```ts
// director.test.ts
it("capital sounds: the player's capital threatened → warning; a capital the player took → knockout", ...);
// minimapGeometry.test.ts
it("a capital threat flashes red at the player's capital", ...);
// contextMenu.test.ts
it('with no planes the build menu leaves out the plane buildings', ...);
// e2e/modes.spec.ts
test('capitals: the star on the start, and a threat warns in the feed, by sound and on the minimap', async ({ page }) => {
  // &capitals=1: after spawning, state.buildings has a capital at the player's spawn; minimap().capital === true;
  // replayEvents([{ type: 'capitalThreat', nation: me, tile }]) → feed 'Your capital is under attack!', sound().played has 'warning',
  // minimap().flashes ≥ 1; no console errors
});
test('no planes: 8 build buttons, and the plane hotkeys do nothing', async ({ page }) => {
  // &noplanes=1: 8 .hud button.build; after grant({ gold: 100000 }) (so the plane buildings would be affordable),
  // pressing 9, 0 and - leaves the controls in the default mode (no placing banner)
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** The hotkeys need no change: `canBuild` already says no when a type has no button.
- [ ] **Step 4: Run → PASS** (unit, then `npx playwright test e2e/modes.spec.ts`).
- [ ] **Step 5: Commit** "feat(capitals): the capital star, its warnings and sounds; the build bar follows the rules"

---

## Milestone 6 — Finish

### Task 12: Docs, screenshots and the final checks

**Files:**
- Modify: `README.md` (a "Game modes" section: teams, capitals, custom rules, the URL parameters), `docs/decisions.md` (a "Step C" section with every ruling from the ledger), `e2e/screenshots.spec.ts` (three new shots), `docs/screenshots/` (`7-menu-rules.png`, `8-teams.png`, `9-capital.png`)

- [ ] **Step 1: Write the screenshot tests** (they run only with `SCREENSHOTS=1`, like the others): the menu with Custom rules open; a teams match after 40 s; a capitals match zoomed on a capital.
- [ ] **Step 2: Run** `SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts` and look at each picture.
- [ ] **Step 3: Final checks**, each read in full: `npm run typecheck`; `npm test`; `npm run build`; `npm run e2e` (no console errors); `npm run perf` and `npm run perf -- --bots 40 --teams 4 --capitals`; `npm run arena -- --seeds 20 --size small` (**Arena unchanged**), `-- --mode teams`, `-- --capitals`.
- [ ] **Step 4: Commit** "docs: Borderline game modes — README, decisions and screenshots"
