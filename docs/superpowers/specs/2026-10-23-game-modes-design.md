# Borderline: teams, capitals and custom rules (Step C) — design

## Context

Step C of the follow-up round (A: one game speed and fixes, B: look and sound, C: game modes, D: chatty bots and a
how-to-play tutorial). Borderline is played alone against bots in the browser; there is no online play, and this step
adds none.

What the player asked for, in their words and choices:
- **Teams with bots:** "you and some bot teammates against other bot teams".
- **Team setup:** choose 2, 3 or 4 teams on the menu; bots are split evenly; everyone starts anywhere ("mixed").
- **Teammates:** "a mix of all … kinda ignore you and just do their thing. But sometimes u can gang up on someone or
  they can give you some aid … if u get attacked they attack them n or help defend you … they can also do their own
  thing and kinda cuck u." Teammates never attack each other (stated, not objected to).
- **Capitals:** your starting spot is your capital; when it falls you are out and whoever took it gets all your land.
- **Custom rules:** all six switches: rich start, fast building, big armies, no planes, no alliances, win at
  60% / 80% / 100%.
- **Approach:** one rulebook that every part of the game reads (approach 1 of 3).

**Done means:**
- The menu sets up free-for-all or teams, capitals and the custom rules; free-for-all with everything off plays
  exactly like today (the arena results stay 90% / 95% / 100%).
- Teams, teammate bots, capitals and every switch work in any combination, with the tests below passing.
- The simulation stays deterministic: the same seed and rules replay the same match.

## Part 1 — The rulebook and the menu

**The rulebook** (`src/shared/rules.ts`)
```ts
interface MatchRules {
  mode: 'ffa' | 'teams';
  teams: 2 | 3 | 4;          // used when mode is 'teams'
  capitals: boolean;
  richStart: boolean;
  fastBuilding: boolean;
  bigArmies: boolean;
  noPlanes: boolean;
  noAlliances: boolean;
  winShare: 0.6 | 0.8 | 1;
}
```
- `DEFAULT_RULES`: free-for-all, 2 teams, everything off, `winShare` 0.8.
- `StartOptions.rules` carries it to the worker; `GameSetup.rules` to the game (`game.rules`, missing means the
  defaults, so every existing test and the arena stay as they are).
- `tuningFor(rules)` (`src/sim/core/tuning.ts`, pure) turns the switches into numbers: start gold, gold scale,
  troop growth scale, troop cap scale, build time scale, win share, planes allowed, alliances allowed. The systems read
  `game.tuning` where they read those values from `CONFIG` today. With the defaults every number equals today's.
- `describeRules(rules)` gives the short label shown in the game, e.g. "Teams · Capitals · Rich start · Win at 60%";
  free-for-all with nothing on gives "Free-for-all".
- `minBots(rules)`: with teams, every team needs at least 2 nations, so at least `2 × teams − 1` bots.

**The menu** (`src/client/ui/menu.ts`)
- New rows: **Mode** (Free-for-all / Teams); **Teams** (2 / 3 / 4, shown only for Teams); **Capitals** (off / on).
- A **Custom rules** section that folds open (closed by default): five on/off switches and **Win at** (60% / 80% /
  100%). Everything off by default, win at 80%.
- If the bot count is below `minBots`, the game starts with `minBots` bots and the menu says so under the bots field
  ("4 teams need at least 7 bots — the game will use 7").
- The menu remembers the last choices (map, size, bots, difficulty, name, mode, teams, capitals, custom rules) in
  browser storage through `safeStorage` (key `borderline.menu`); bad or missing data gives the defaults.
- URL parameters for tests and links: `mode=teams&teams=3&capitals=1&rich=1&fast=1&big=1&noplanes=1&noalliances=1&win=60`.

**In the game**
- The rules label sits above the leaderboard.

## Part 2 — Teams

**Who's on which team** (`src/sim/core/teams.ts`, pure)
- `assignTeams(playerId, botIds, teams, rng)`: the bots are shuffled with their own random stream (a new salt, so the
  game's other streams are untouched) and dealt into teams. The player is always on team 1 (Blue).
- Sizes differ by at most one, and the player's team is never bigger than another: with `n` nations and `t` teams, the
  player's team has `floor(n / t)` and the extra nations go to the other teams. Example: 12 bots and 2 teams gives you
  plus 5 bots against 7 bots.
- `Nation.team`: 1–4 in teams mode, 0 in free-for-all.
- Spawns work as today (anywhere, with the usual spacing).

**Colours** (`src/shared/colors.ts`)
- Team colour families: Blue (yours), Red, Green and Gold. `teamColor(team, indexInTeam, isPlayer)` gives each nation a
  shade of its family (hue and lightness steps, as far apart as the family allows). The player keeps `PLAYER_COLOR`.
- Free-for-all keeps today's palette.

**Between teammates** (sim)
- Teammates are allied from the start, and the alliance is locked: breaking it, an embargo on a teammate and attacks
  on a teammate are refused (`'teammate'`, or the existing `'allied'` for attacks).
- New command `sendAid { to, gold, troops }`: an immediate gift between teammates (no accept step). Gifts to other
  nations still go through a deal, as today.
- New command `askAid { to, resource: 'troops' | 'gold' }`: a request of the new kind `'aid'`. The asker may ask the
  same teammate again only after 30 seconds (300 ticks); an earlier ask is refused (`'tooSoon'`). The existing "ask to
  attack" (joint attack request) follows the same 30-second rule between teammates.

**Between teams**
- Alliance proposals between nations of different teams are refused (`'otherTeam'`). War, peace, deals and embargoes
  work as today.

**Winning** (`src/sim/systems/victory.ts`)
- Teams mode: a team wins when its living members together hold `winShare` of the land, or when it is the only team
  with living members. The winners are all of the team's members, including knocked-out ones.
- Free-for-all: today's rules, with `winShare` from the rules.
- `GameResult` gains `team: number | null` (the winning team, or null in free-for-all).

**On screen** (client)
- **Leaderboard:** in teams mode, grouped by team: team name, colour and total land share, then its nations;
  knocked-out members are greyed and kept in the list.
- **End screen:** "Team victory" when your team wins, or "Defeat — Red team won"; your stats plus your team's land
  share. A knocked-out player whose team wins later gets the victory screen.
- **Diplomacy panel on a teammate:** a "Teammate" badge; buttons: Send gold, Send troops (using the attack-size slider,
  as gifts do today), Ask for troops, Ask for gold, Ask to attack…. No alliance, break or embargo buttons. The ask
  buttons show the seconds left while the 30-second wait runs (from a new `askReadyIn` field in the nation snapshot).

## Part 3 — Teammate bots

**Team spirit** (`src/sim/ai/profile.ts`, `src/sim/ai/teamwork.ts`)
- Each bot's team spirit is its personality's base value plus a fixed random offset in ±0.1 (from the bot's own random
  stream): diplomat 0.9, trader 0.75, builder 0.6, aggressive 0.4, opportunist 0.25.
- Team spirit only matters for teammates; free-for-all bots behave exactly as today.

**Their own business**
- Bots keep choosing their own wars and expansion with today's scoring. They never attack a teammate.

**Helping on their own** (checked when the bot thinks; each bot helps on its own at most once every 10 seconds —
answers to your asks don't count toward this)
- **Hit back:** a teammate is being attacked by a nation that borders this bot → with a chance of its team spirit, the
  bot attacks that nation with up to half of its attack budget.
- **Gang up:** a teammate is attacking a nation that borders this bot → with a chance of its team spirit × 0.8, the bot
  attacks it too.
- **Aid:** a teammate is under attack and below 25% of its troop limit → with a chance of its team spirit × 0.6, the bot
  sends troops: up to 20% of its troops, never dipping below the reserve it keeps for its own defence.
- Attack commands from these carry `support: { ally, kind: 'join' | 'defend' }`, echoed in `attackStarted`, so the
  feed can say what happened. Aid shows as a new `aidSent { from, to, gold, troops }` event.

**When you ask** (the bot answers on its next think)
- **Ask for troops / gold:** yes when a roll under its team spirit succeeds and it can spare some; a yes sends up to
  20% of its troops (above its reserve) or 30% of its gold (above what its next building needs). A no carries a reason:
  `'busy'` (it is at war itself and losing ground), `'cantSpare'` (nothing above its reserve), or `'notNow'` (the roll
  failed). `requestResolved` gains the optional `reason`.
- **Ask to attack someone:** today's joint-attack rule, with the target's score requirement eased by team spirit for
  teammates; a yes focuses the bot on that target for a while (as today).

**The selfish side**
- Comes from the bots' own scoring, unchanged: they take free land near you, finish off weakened enemies (opportunists
  most), and say no when the rolls go against you.

**News feed lines** (`src/client/ui/eventText.ts`; Step D will make bots chattier)
- "Nirenia joins your attack on Varlonia" — "Fenyutra strikes back at Zanbaia for you" — "Nuni sent you 4.2k troops" —
  "Danmek says no: busy with its own war" / "can't spare any" / "not now". Lines about other teams' teamwork are not
  shown.

**Enemy teams** use the same teamwork among themselves.

## Part 4 — Capitals

**The capital** (`src/sim/systems/capitals.ts`)
- Only with capitals on: a new building type `'capital'`, placed on the spawn tile when a nation spawns (bots placed
  at random at the end of the spawn phase included) and moved when it moves its spawn in the spawn phase. One per
  nation.
- It defends like a fortress: the defence multiplier counts it with the fortress's radius and multiplier.
- It can't be built, moved or sold: it is left out of the build bar, the right-click build menu and the bots' building
  choices. Bombs don't destroy it.
- Paratroopers and boat landings can't target a tile within 3 tiles of an enemy capital in any direction (a 7×7
  square; refused `'nearCapital'`).

**When it falls** (the capital's tile is captured)
- The owner is out at once: every tile and building it has goes to the capturer, its troops, gold, ships and planes
  are lost, and its attacks and requests end. One `capitalFell { nation, by, tiles }` event, then the usual
  `eliminated { nation, by }` (no `buildingCaptured` event per building).
- The capital itself is removed; the capturer keeps its own.

**Warnings**
- `capitalThreat { nation }` when an enemy takes a tile within the capital's reach (the fortress radius), at most once
  every 30 seconds per nation.
- For the player: a red feed line "Your capital is under attack!", the warning sound and a red minimap ring at the
  capital. When any capital falls: "Danmek's capital fell to Nuni — Danmek is out"; the knockout sound when the player
  took it.

**Pressing toward a target**
- With capitals on, an attack presses toward the tile it was aimed at: among its frontier tiles, the ones nearer the aim
  go first (a distance term in the frontier priority). The player's attacks aim at the clicked tile; bots aim at an
  enemy capital when they go for one. Free-for-all attacks are unchanged.

**Bots**
- Defence: while an enemy front is within their capital's reach, bots keep a bigger reserve, and early on they place a
  defence post near their capital.
- Offence: a neighbour whose capital the bot can reach scores extra, in proportion to that neighbour's land.

**On screen**
- Every capital shows as a star in its nation's colour on the map (drawn like the building icons); the minimap marks
  the player's own capital.

## Part 5 — Custom rules

| Switch | Effect |
|---|---|
| Rich start | Start gold 5,000 instead of 500; all gold income ×2 (base, land, factories, banks and trade). |
| Fast building | Building times ÷5, warships and fighters included (a fortress: 2 s instead of 10 s). |
| Big armies | Troop growth ×2; every troop limit ×2 (base, per tile and cities). |
| No planes | Airports, anti-air guns and radar stations can't be built and leave the build bar; no bombers, fighters, paratroopers or trade planes for anyone. |
| No alliances | Nobody can propose an alliance, so there are no allies to ask for joint attacks; peace, deals, gifts and embargoes still work. Teammates stay allied and can still ask each other to attack. |
| Win at | The land share that wins: 60%, 80% or 100% (or last one standing). |

- Bots read the real numbers (`game.tuning`), so they adapt; with no planes their air logic is skipped and they never
  pick the plane buildings; with no alliances they never propose one.

## Part 6 — Testing, checks and delivery

**Unit tests** (Vitest)
- Rules: defaults, URL parsing, `describeRules`, `minBots`, `tuningFor` (defaults equal today's `CONFIG`).
- Teams: sizes and the player's team never biggest; the same seed gives the same teams; locked alliances (attack,
  break and embargo refused); no alliances across teams; `sendAid`; `askAid` and the 30-second wait.
- Victory: team land share (living members), last team standing, knocked-out members among the winners, `winShare`
  60% and 100%.
- Capitals: placed on spawn and moved with it; fortress defence; falls → land and buildings to the capturer, the
  loser out, one `capitalFell`; bombs leave it; paratroopers and landings refused near it; threat events rate-limited;
  aimed attacks press toward the aim.
- Custom rules: each switch's numbers; no planes refuses the plane buildings and units; no alliances refuses proposals.
- Teammate bots: hit back, gang up, aid (and the reserve respected), answers to asks with each reason, at most one
  help every 10 seconds, team spirit by personality.
- Determinism: a teams + capitals + rules match replays identically from the same seed.

**Arena** (`npm run arena`)
- Free-for-all with the default rules: unchanged, 90% / 95% / 100%.
- New `--mode teams`: two teams of 4, hard against easy — the hard team wins at least 70%.
- New `--capitals`: capitals matches reach the arena's time limit at most half as often as the same matches without
  capitals.

**Browser tests** (Playwright)
- The menu: mode, teams, capitals and the custom rules; the choices are remembered after a reload.
- A teams match: team colours, the grouped leaderboard and the rules label; asking a teammate for troops shows its
  answer in the feed.
- A capitals match: the capital star is drawn; an attack near it raises the warning.
- The "Team victory" screen (forced result).
- No console errors in any of them.

**Speed** (`npm run perf`)
- A world-map match with 40 bots in teams with capitals stays within the 20 ms step budget.

**Screenshots**
- New: the menu with custom rules open, a teams match, a capital under attack.

**Delivery**
- A plan of tasks; each task built by one helper and checked by a separate one, with fixes before the next task; a
  fresh reviewer over the whole of Step C at the end.
- Branch `claude/clever-cray-5279az` (restarted from `main` after PR #2), with its own pull request.

## Decisions made without asking

1. Free-for-all with the default rules is untouched, down to the arena results. — If wrong: none.
2. Team members are dealt at random from the seed; the player is always on Blue; at least 2 nations per team, with
   the bot count raised to fit. — If wrong: a player who wanted to pick teammates can't.
3. Team colour families Blue, Red, Green and Gold, each nation a shade of its family. — If wrong: nations inside a
   big team are harder to tell apart (they are allies, so it matters less).
4. Gifts between teammates arrive at once, without an accept step. — If wrong: none.
5. Asking: 30 seconds per teammate; the bot decides the amount (up to 20% of its troops or 30% of its gold above what
   it needs). — If wrong: aid feels a little small or large; easy to tune.
6. A bot helps on its own at most once every 10 seconds. — If wrong: teammates feel a bit quiet or busy; easy to tune.
7. Team spirit values per personality as listed, ±0.1 per bot. — If wrong: easy to tune.
8. The capital defends like a fortress; no paratroopers or landings within 3 tiles; bombs can't destroy it; the
   capturer gets the land and buildings, while troops, gold, ships and planes are lost. — If wrong: capitals fall
   too easily or too hard; tune the reach and strength.
9. Capital warnings at most once every 30 seconds. — If wrong: too few or too many warnings.
10. With capitals on, attacks press toward the tile they were aimed at; without capitals attacks are unchanged. — If
    wrong: attacks with capitals feel more pointed than without.
11. Rich start 5,000 gold and income ×2; fast building ÷5; big armies ×2; no planes also removes anti-air guns and
    radar. — If wrong: easy to tune.
12. "Matches with capitals must always end" is checked as: capitals matches reach the arena's time limit at most half
    as often as without capitals (the arena caps every match's length, and some free-for-all matches already reach
    it). — If wrong: a capitals stalemate could still happen; the end of the arena report shows how often.
13. Teamwork lines about other teams are not shown in the news feed. — If wrong: the feed shows less of what enemy
    teams are doing.
