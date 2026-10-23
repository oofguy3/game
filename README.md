# Borderline

A browser strategy game in the spirit of Roblox's "take over the world" games: start from a single spot on the world
map or a random one, grow your territory, build an economy and an army, and take the map from up to 40 computer
opponents.

**Play:** https://oofguy3.github.io/game/ (once Pages is turned on — see below)

![Mid-game: buildings, the right-click build menu and the diplomacy panel](docs/screenshots/4-diplomacy.png)

## How to play

**Goal:** hold 80% of the land, be the last nation standing, or end the game allied with everyone left.

1. Pick a map (the world or a random one), how many bots and how good they are (Easy, Normal, Hard, Insane).
2. Click where you want to start. When the countdown ends, the war begins.
3. Click next to your land to expand into it or attack its owner. The attack-size slider sets how many of your troops
   go. Troops grow back over time, fastest when you hold about half of your maximum.
4. Spend gold on buildings, ships and planes; right-click anywhere for everything you can do there.
5. Make alliances, peace and trade deals with other nations — and watch out for betrayal.

### Controls

| Input | What it does |
|---|---|
| Left click | Expand or attack there (by boat if it is across the water); during the start, choose your spot |
| Right click | Menu: attack, send a boat, bomb, paratroopers, build, build a warship or fighter, move a warship, diplomacy |
| Drag | Move the map |
| Mouse wheel | Zoom |
| W A S D / arrow keys | Move the map |
| `1`–`9`, `0`, `-` | Pick a building to place: City, Factory, Barracks, Bank, Defense post, Fortress, Port, Naval base, Airport, Anti-air gun, Radar station |
| `[` / `]` | Attack size down / up by 10% |
| Space | Pause / resume |
| Esc | Cancel placing a building; close the menu |

### Buildings

| Building | Does |
|---|---|
| City | More max troops |
| Factory | More gold |
| Barracks | Troops grow faster |
| Bank | Gold, and more from trade |
| Defense post / Fortress | Nearby land is harder to take |
| Port (coast) | Trade ships, and more troop boats at once |
| Naval base (coast) | Builds warships |
| Airport | Bombers, paratroopers, fighters and trade planes |
| Anti-air gun | Shoots down enemy planes |
| Radar station | Warns of incoming planes and makes anti-air and fighters better |

## Development

Needs Node 22.

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Run the game locally with hot reload |
| `npm test` | Unit and simulation tests (Vitest) |
| `npm run e2e` | Browser tests (Playwright; builds and serves the game first) |
| `npm run arena -- --seeds 20 --size small` | Bot-vs-bot matches between neighbouring difficulties; fails if a harder level wins under 70% |
| `npm run perf` | Times the simulation on the world map with 30 Insane bots; fails above 20 ms per tick |
| `npm run build:world` | Rebuilds `public/maps/world.bin` from Natural Earth data |
| `npm run build` | Type-checks and builds the site into `dist/` |

The simulation (`src/sim`) runs in a Web Worker and is deterministic for a given seed; the page (`src/client`) only
draws it and sends commands. Every balance number is in `src/shared/config.ts`. Bot strength results are in
[`docs/ai-arena-results.md`](docs/ai-arena-results.md).

## Publishing on GitHub Pages

1. In the repository on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Merge to `main` (or run the "Deploy to GitHub Pages" workflow by hand). The workflow tests, builds and publishes.
3. The game is then at **https://oofguy3.github.io/game/**.

The CI workflow runs the type check, tests and build on every push and pull request.
