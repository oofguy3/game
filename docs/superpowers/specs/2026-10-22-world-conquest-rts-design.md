# World-conquest strategy game (browser) — design & plan

## Context

You asked for a game like the Roblox "take over the world" games, specifically RoFront and the RTS games. In RoFront you pick a starting spot on a world map. Your troops push your territory outward, you build cities, factories and defenses, and you win by owning most of the map.

The repo `oofguy3/game` is empty apart from a README, so this is a new project. The game will be original: its own code, art and name, built around that style of play.

**What you told me:**

- It runs in a **web browser** and you play it with a **mouse on a computer**.
- You play **solo against computer bots**. There's no online multiplayer.
- Maps: the **real world map**, plus **random maps**.
- First version includes:
  - **buildings** (more types than the basics)
  - **boats**
  - **alliances**
  - **trading**: trade ships and trade planes, plus a deals menu
  - **planes**: trade planes, bombers, paratroopers and fighters
- **No nukes** for now.
- **The main focus is the AI**: it should be genuinely hard to beat. There's a difficulty picker: Easy, Normal, Hard and Insane.
- Look: **clean flat colors**.
- Put it **online with a free GitHub Pages link**.
- Build it **all at once**, not in stages you play along the way.
- **Name it later.** A placeholder name sits in one constant so it's easy to change.

**What I decided for you** (correct me when you review this plan):

- **Extra buildings:** you had no preference, so I picked **anti-air gun, naval base and radar**. They make the planes and boats you asked for more interesting. Research lab, embassy and hospital are left out for now.
- **No fog of war.** You can see the whole map, like RoFront.
- **Speed controls.** Pause, 1×, 2× and 4× work because it's single-player.
- **Captured buildings change owner.** When land is taken, its buildings go to the conqueror.
- **The AI doesn't cheat.** Harder levels are smarter, with no free resources.

---

## How the game plays

### Start
1. **Menu:** choose the map (World, or Random with small/medium/large size and a seed), the number of bots (4–40) and the difficulty.
2. **Spawn phase (~10 s):** click where you want to start. Bots pick their own spots, and harder bots pick better ones.

### Resources
- **Troops**
  - Troops grow over time, up to a maximum set by your land, cities and barracks.
  - Growth is fastest at about half of max and slows near max, so sitting at max wastes growth. That gives the game a real "when to attack" decision.
- **Gold**
  - Gold comes from land, factories, banks/markets and trade.
  - Everything you build costs gold. Each extra building of the same type costs more.

### Attacking and expanding
- **Choosing an attack**
  - Left-click a tile to attack its owner, or to spread into empty land.
  - An **attack-% slider** sets what share of your troops to send.
- **How the front moves**
  - The attack moves along the shared border tile by tile.
  - Each tile costs the attacker troops based on:
    - the terrain (plains 1.0, hills 1.5, mountains 2.5)
    - how densely the defender holds that land (their troops ÷ their tiles)
    - any defense buildings in range
  - The defender loses troops for every tile they lose.
- **Empty land** is cheap to take.
- **Counterattacks** work the same way.
- **Win, lose and alliance victory**
  - **Win:** you own **80% of all land**, or every other nation is gone.
  - **Alliance victory:** if every nation left is in one alliance, that alliance wins together.
  - **Lose:** you lose all your land. You can then keep watching the game.

### Buildings (11)
You place buildings on your own land. They take a few seconds to build.

| Building | What it does |
|---|---|
| City | +max troops |
| Factory | +gold income |
| Barracks | Troops grow faster |
| Bank / Market | +gold, and +10% trade income |
| Defense Post | Land within a small radius is harder to take |
| Fortress | Big defense bonus over a larger radius. Expensive |
| Port (coast only) | Sends trade ships and lets you have more troop boats at once |
| Naval Base (coast only) | Builds warships |
| Airport | Builds planes and sends trade planes. Planes have a range limit from their airport |
| Anti-Air Gun | Shoots enemy planes within its radius |
| Radar Station | Warns you about incoming planes, and makes your anti-air guns and fighters better inside its radius |

### Sea
- **Troop boat**
  - Launches from any coast tile you own, carrying troops to a chosen enemy or empty shore.
  - When it lands, an attack starts from that beach.
  - Only a few can be out at once. Ports raise that limit.
- **Trade ship**
  - Ports send trade ships automatically to other nations' ports.
  - When one arrives, both nations get gold. Longer trips pay more.
- **Warship**
  - Built at a naval base.
  - It patrols an area and attacks enemy troop boats, trade ships and warships.

### Air
- **Trade plane:** airports send these automatically to other nations' airports. Both sides get gold.
- **Bomber:** flies to a target and destroys buildings and troops in a small area.
- **Paratroopers:** a plane drops troops on a tile far away, and an attack starts from there.
- **Fighter:** patrols around its airport and shoots down enemy bombers and paratroop planes. Fighters also fight each other.
- **Interception:** anti-air guns and fighters can shoot down any plane from a nation they're at war with, including trade planes.

### Diplomacy and trading
- **Relations:** every pair of nations is either **Allied**, **Neutral** or **At War**.
  - Attacking someone, or sinking, bombing or shooting down their stuff, puts you **at war**.
  - **Peace** happens by agreement.
- **Alliances**
  - Allies can't attack each other.
  - Breaking an alliance is a **betrayal**. Every bot trusts the betrayer less for a while.
- **Trade units:** trade ships and planes only travel between nations that aren't at war.
- **Embargo:** you can switch trade off with any nation.
- **Deals menu.** With any nation you can:
  - offer gold for troops, or troops for gold
  - send a gift
  - ask for peace
  - propose an alliance
  - ask an ally to attack a target

  Bots accept or refuse based on what's actually good for them.

---

## The AI (main focus)

Each bot runs a decision loop with these layers.

**Perception (what the bot sees)**
- Its neighbours, how long each shared border is, and their troops and troop density.
- Defenses on each front.
- Who is fighting whom.
- Threats to its own borders.
- Its own economy.
- Who is closest to winning.

**Strategy (every few seconds)**
- Every possible action gets a score, and the bot picks the best one. The actions are:
  - expand into empty land
  - attack a nation
  - build up the economy
  - defend
  - invade by sea
  - run an air campaign
  - use diplomacy
- **Picking a target** weighs:
  - the land and buildings it would win
  - the troops it would cost
  - the risk of leaving other borders weak
  - whether the target is already busy fighting someone else, which is a good time to strike
  - its relationship with that nation
- **Sizing an attack.** The bot works out the outcome with the same combat rules the game uses. It sends enough troops to win decisively and keeps a defensive reserve sized to the threats it sees.
- **Troop timing.** The bot keeps its troops in the fast-growth range and attacks before it hits max. This is a big part of what separates good bots from bad ones.

**Economy planner**
- Ranks buildings by how fast they pay for themselves.
- Places them sensibly:
  - cities and factories deep inside its land
  - defense posts and fortresses on threatened fronts and chokepoints
  - ports near trade partners
  - airports within range of targets
  - anti-air and radar near valuable clusters of buildings

**Sea and air**
- Invades by boat when its own continent is full or a juicy target is overseas.
- Uses warships to protect its trade and sink invasion boats.
- **Combined arms:** bombs enemy defenses just before attacking and drops paratroopers behind the front to split the enemy.
- Builds fighters and anti-air guns when enemies have airports.

**Diplomacy**
- Makes alliances to avoid fighting a war on two fronts.
- Accepts or refuses offers based on how useful they are.
- **Betrays** an ally when that ally is weak and the best target, if its personality allows it.
- **Gangs up on whoever is close to winning**, including you.

**Personalities**
- The personalities are Aggressive, Builder, Trader, Opportunist and Diplomat.
- They change the bots' scoring weights, so the bots don't all play the same way.

**Difficulty**
- Easy, Normal, Hard and Insane differ in:
  - how fast bots react
  - how well they plan
  - how many mistakes they make
  - whether they use combined arms, betrayal and coordinated gang-ups
- No level gets resource cheats.

**Proving the AI is good**
- A headless **AI arena** (`npm run arena`) plays many bot-vs-bot matches on random seeds without opening the game.
- What counts as passing:
  - Insane beats Hard in at least 70% of matches.
  - Hard beats Normal in at least 70%.
  - Normal beats Easy in at least 70%.
- I'll tune the AI against these numbers.

---

## Technical design

- **Stack:** TypeScript, Vite, HTML5 Canvas 2D, with no game engine. Vitest for tests and Playwright for browser tests (Chromium is already installed).
- **Simulation**
  - Pure deterministic TypeScript with no DOM: seeded RNG, fixed tick rate (~10 ticks/s).
  - It runs in a **Web Worker** so heavy AI thinking never freezes the screen.
  - The same code runs headless in Node for tests and the arena.
- **Map**
  - A tile grid of about 1,500 × 750 for the world map, stored as typed arrays (owner, terrain).
  - **World map:** a script (`scripts/build-world-map.ts`) turns the `world-atlas` land outlines (npm) into tiles.
    - It cuts off the far poles.
    - It adds hills and mountains using noise.
    - The output is saved as `public/maps/world.bin`, which is committed.
  - **Random maps:** seeded fractal noise makes continents and islands, with checks for enough land.
  - **Water routes:** pathfinding runs on a coarse water grid that's worked out once per map.
- **Rendering**
  - One canvas image for territory colors, with darker borders. Only the tiles that changed get redrawn.
  - Buildings and units are simple flat icons. Nation names are drawn at the middle of each territory.
  - Pan by dragging or with WASD, and zoom with the mouse wheel.
- **UI**
  - It's HTML/CSS laid over the canvas:
    - a bottom bar: troops, gold, income, attack-% slider and build buttons with hotkeys
    - a leaderboard
    - speed controls
    - a right-click menu: attack, boat, bomb, paratroopers, diplomacy
    - a diplomacy panel
    - an event feed, e.g. "Bombers incoming!", "Blue wants an alliance"
    - an end screen with stats
- **Balance:** all numbers live in `src/shared/config.ts` so tuning is easy.

### Planned layout
```
index.html, package.json, tsconfig.json, vite.config.ts (base: '/game/')
src/shared/      types, config.ts (balance), constants (game name)
src/sim/map/     grid, terrain, random generator, world-map loader, water nav
src/sim/core/    game state, tick loop, RNG, win conditions
src/sim/systems/ attacks/territory, economy, buildings, naval, air, trade, diplomacy
src/sim/ai/      perception, strategy, economy planner, military, naval, air, diplomacy, personalities, difficulty
src/worker/      Web Worker wrapper around the simulation
src/client/      renderer, camera, input, UI panels, styles
scripts/         build-world-map.ts, arena.ts
public/maps/     world.bin
.github/workflows/deploy.yml   build + deploy to GitHub Pages
```

### Build order
The milestones below are internal checkpoints. You play at the end.

1. Scaffold the project, generate both map types, and render them with pan and zoom.
2. Core simulation: nations, spawning, troops and gold, attacks and expansion, win and lose. Basic UI.
3. The land buildings.
4. AI core: strategy, target choice, economy planner, personalities, difficulty levels, and the arena.
5. Sea: troop boats, ports, trade ships, naval base, warships, and the AI's naval play.
6. Air: airports, the four plane types, anti-air guns, radar, and the AI's air play.
7. Diplomacy: alliances, betrayal, peace, deals, embargo, joint attacks, and the AI's diplomacy.
8. Tune the AI in the arena, polish the UI, add browser tests, and set up GitHub Pages.

All work is on branch `claude/clever-cray-5279az`, committed and pushed as each milestone is finished.

### After you approve this plan
1. Save this design to `docs/superpowers/specs/2026-10-22-world-conquest-rts-design.md` and commit it.
2. Write a detailed step-by-step implementation plan, which you review. You also choose how it gets carried out.
3. Build it.

---

## Verification

- **Unit tests (Vitest):**
  - combat math and tile capture
  - troop growth
  - each building's effect
  - boat pathfinding and landing
  - plane range, interception and bombing
  - trade income
  - diplomacy rules, e.g. you can't attack an ally, and betrayal hurts trust
  - map generation: same seed gives the same map, and land is within the expected range
- **AI scenario tests:** small scripted maps that check specific moves:
  - the bot defends when threatened
  - it uses boats when its continent is full
  - it never attacks an ally unless it's betraying them on purpose
  - it bombs defenses before attacking
- **AI arena:** the win-rate targets above (≥70% for each higher difficulty), run with `npm run arena`.
- **Performance:** on the world map with 30 Insane bots, the average simulation tick stays under 20 ms.
- **Browser tests (Playwright + Chromium):**
  - load the game, start a match, spawn and attack
  - build buildings, send a boat and a bomber, propose an alliance
  - fail on any console error
  - take screenshots so I can check the look
- **Deploy**
  - `npm run build` succeeds, and the GitHub Actions workflow builds the site and deploys it to GitHub Pages.
  - **Your part:** in the repo, open **Settings → Pages** and set **Source = GitHub Actions**.
  - The link (`https://oofguy3.github.io/game/`) goes live once the work is merged into `main`. I can open a pull request for that if you want.
