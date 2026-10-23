# Borderline: new look and sound (Step B) — design

## Context

The game is live at https://oofguy3.github.io/game/. It works, but it looks plain. The map is one flat colour per land type, each nation's land is a flat colour with a darker edge, there is no sound, and there is no minimap. The name is still the placeholder "Untitled Conquest".

Step B of the follow-up round makes the game look and sound better. The user answered these questions one at a time:

| Question | Answer |
|---|---|
| What should look better? | The map, the territories, and the menus and screens. Units and buildings keep their icons. |
| Which style? | Clean and modern. Natural land colours with soft shading. Nations look like tinted glass over the land. One sleek dark style for every panel. |
| Which sounds? | Action sounds and alerts. No music. Mute button and volume slider. |
| What does the minimap show? | Every nation's land, a box for the view, click or drag to jump, M to hide. Red danger flashes. |
| Name | Borderline |
| Logo | A mix of the "split badge" and the "globe": a globe of coloured territories cut in two by a jagged border, blue on the left and red on the right, with BORDERLINE beside it. It is also the browser-tab icon. |
| How to draw the map | Option 1: draw the map with the graphics chip (WebGL2). Keep the other drawing on the existing 2D canvas on top. |

The user confirmed these assumptions:
1. Only the looks change. Beaches, forests and snow are decoration. The rules and the bots stay exactly the same.
2. It stays smooth on an ordinary laptop, even on the world map with 40 bots.
3. The player only hears what involves them.
4. Sound starts on at half volume, and the game remembers the setting.
5. The web address stays the same.

The user approved Parts 1–3 below section by section, then said to go ahead and build everything without further check-ins. Parts 4 and 5 follow what the user already chose in the questions.

**Done means:**
- Old and new screenshots side by side clearly show the difference.
- Every sound on the list plays at the right moment, and mute silences all of them.
- The minimap jumps where you click and flashes where you're attacked.
- The game plays the same as before: all current tests pass, and the arena win rates are unchanged.

## Part 1 — Map and territories

### What the player sees

- **Land:** natural colours.
  - Green lowlands, darker forests, drier tan patches, grey-brown mountains with white peaks.
  - Sandy beaches along the coasts.
  - Snow toward the poles. On random maps, the snow is toward the top and bottom edges.
  - Soft shading, lit from the top-left, makes hills and mountains look raised.
- **Water:** deep blue far out, lighter near the coast, with a slow, gentle shimmer.
- **Edges:** coastlines and borders are smooth curves at every zoom level, not square steps.
- **Territories:** each nation's colour sits over the land like tinted glass, about half see-through.
- **Borders:**
  - A thin bright line in the nation's colour wherever its land meets land that isn't its own: another nation's land, or empty land. A soft glow sits just inside the line.
  - Coasts get no border line. The beach and water mark the edge.
- **Captured land:** it flashes lighter, then fades back within about a second.
- **Front lines:** where one nation is attacking another, their shared border becomes a brighter, thicker line that pulses. Attacks into empty land don't count as front lines.
- **Defeat:** the map fades to grey (see Part 2).

### How it is built

**Two stacked canvases**
- `canvas.map-gl` (WebGL2) is at the bottom and draws only the map.
- `canvas.map` (2D) is on top, with a transparent background. It still draws buildings, units, labels and effects, and it still receives all mouse input.
- **Fallback:** without WebGL2, the WebGL canvas is never created, and `canvas.map` draws today's flat territory picture exactly as it does now.
- **Context loss:** if the WebGL context is lost mid-match, the game switches to the flat look for the rest of the match.
- **`?look=flat`:** this URL switch forces the flat look, for comparisons and tests.

**Static look data** (`src/client/render/look/terrainLook.ts`, pure, Node-testable)
- This is computed once per map from the terrain, so the same map always looks the same.
- `coast` — signed distance from each tile to the coastline, in tiles. It is positive on land, negative on water, clamped to ±8 and stored in one byte. The GPU blends it smoothly between tiles, and the coastline is drawn where it crosses zero, which gives smooth coastlines when zoomed in.
- `shade` — hill shading, 0–255, lit from the top-left. It comes from a smoothed height field: plains low, hills middle, mountains high, plus gentle noise.
- `biome` — three bytes per tile:
  - **Forest:** noise patches on plains and hills, denser where the land isn't dry. None on beaches (closer than 1.5 tiles to the coast), on snow, or on mountains.
  - **Dryness:**
    - World map: the subtropical bands, 15°–35° north and south, varied with noise.
    - Random maps: noise only.
  - **Snow:** a ramp from latitude 58° (none) to 68° (full), plus caps on the highest mountains.
- **Randomness:** all of it comes from a seeded generator, never `Math.random`.
  - Random maps use the map's seed.
  - The world map uses a fixed seed.

**Changing data** (`src/client/render/look/territoryField.ts`, pure, Node-testable)
- `owner` — one byte per tile, holding the nation id. A match has at most 41 nations, so every id fits in a byte. Water tiles hold 255, which is never a nation id, so the shader can tell a coast from a border.
- `edge` — for each owned land tile, the distance (0–4 tiles) to the nearest border tile: a land tile with a 4-neighbour land tile of a different owner, empty land included. Water doesn't count. This drives the inner glow.
  - It is updated around changed tiles in 32×32-tile blocks. The result always equals a full recompute, and a test checks this.
- `captured` — when each tile last changed owner, in seconds on the page clock. This drives the shimmer.
- A dirty rectangle per update says which part of each texture needs re-uploading.

**Shader** (one full-screen pass), for each pixel:
1. Find the map position from the camera.
2. **Terrain:**
   - Water shades from deep to shallow by coast distance, with a slow animated shimmer.
   - Sand lies within about 0.6 tiles inland of the coastline.
   - Land takes its biome colour, multiplied by the hill shade.
3. **Territory:**
   - **Owner:** a smooth boundary from the 2×2 tile neighbourhood. Each owner's weight is the sum of its bilinear weights, and the heaviest owner wins.
   - **Colour:**
     - The owner's land is tinted 50% toward the nation colour.
     - A 1.5 px bright line runs where the land changes owner. Water (255) on the other side doesn't count.
     - The inner glow comes from `edge`.
     - The capture shimmer fades out over 1 second.
     - The front-line style applies where the pair is in an active attack.
4. **Grey fade:** a greyscale uniform for the defeat fade.

**Simulation-to-page additions** (the snapshot only; no rule changes)
- `InitPayload.look: LookOptions`, where `LookOptions = { latitude: { top: number; bottom: number }; seed: number; dryBands: boolean }`. `lookOptions(choice: MapChoice)` in `src/sim/snapshot.ts` works it out.
  - World map: latitudes 78 / −58 (from `WORLD_PROJECTION`), seed 1, `dryBands: true`.
  - Random maps: latitudes 72 / −72, the map's own seed, `dryBands: false`.
- `GameUpdate.fronts: [attacker, target][]` lists the running attacks between two nations (target ≠ 0), each pair once, in a fixed order. The page fills a 64×64 pair table texture from it.

**Colours**
- `src/client/render/look/palette.ts` holds the natural palette.
- The shader gets it as uniforms.
- The flat fallback and the minimap use the same palette, so `TERRAIN_COLORS` is updated to it.

### Performance

- **GPU:** one pass, about eight texture reads per pixel.
- **CPU per update:** updating `edge` in blocks, plus three partial texture uploads for the dirty rectangle. Budget: under 2 ms per update on average, on the world map with 30 insane bots. `npm run perf` measures it by feeding the real changed tiles of that match into `TerritoryField`.
- **Per frame:** the overlay drawing is unchanged. A frame probe in test mode reports the main-thread draw time, and the browser test checks a generous ceiling: under 8 ms on average.

## Part 2 — Menus, screens, name and logo

**Name**
- `GAME_NAME = 'Borderline'` (`src/shared/constants.ts`).
- It is shown on the title screen, in the browser tab and in the README title.

**Logo** (`src/client/ui/logo.ts`)
- `badgeSvg()` returns the badge as an SVG string, in a 100×100 view:
  - A round globe, filled blue (`#3b82f6`) on the left and red (`#ef4444`) on the right.
  - The two halves are split by a jagged north–south border.
  - Lighter continent shapes sit on both halves, with faint grid lines.
  - The jagged border is drawn in white, with a white rim.
- `createLogo()` returns the badge next to a bold "BORDERLINE" wordmark, as HTML text in the heading style.
- `public/favicon.svg` is the badge. A unit test keeps it identical to `badgeSvg()`. `index.html` links to it.

**One shared style** (`src/client/styles.css`)
- **Design tokens:** glass background, stronger glass, line colour, corner radius, shadow, accent, danger, good, and animation lengths.
- Every panel and button uses these tokens. Buttons get hover and press states.
- Panels fade and slide in over 160 ms when they open.
- `prefers-reduced-motion` turns the animations off.
- Headings use the system font at weight 800 with wide letter spacing. There are no font files.

**Title screen**
- **Backdrop:**
  - It uses the world map: `maps/world.bin`, which is 43 KB.
  - It is drawn by the same WebGL map, with about 16 made-up nations grown from random spots on land.
  - The view drifts slowly.
  - Without WebGL2, the backdrop is a dark gradient.
- **Menu card:**
  - The logo and the tagline.
  - Map: World or Random, as segmented buttons.
  - Size: Small, Medium or Large, plus Seed. These show for random maps only.
  - Bots: a slider plus a number box.
  - Difficulty: Easy, Normal, Hard or Insane, as segmented buttons.
  - Your name.
  - Play.
  - Each group of segmented buttons is a `role="radiogroup"` with `role="radio"` buttons, so screen readers and the browser tests can find them.

**In-game panels**
- They use the shared style.
- Each build button shows its building's icon, drawn with `drawBuildingIcon` in the player's colour on a small canvas.

**End screens**
- **Victory:**
  - The card pops in: it grows from 90% to full size over 350 ms.
  - The title has a moving shine.
  - About 90 confetti pieces fall for 2.5 s, in the player's colour plus white and gold. They never block clicks.
  - The stats count up over 800 ms.
- **Defeat:**
  - The map fades to grey over 1.2 s. It uses the shader uniform, or CSS `grayscale` in the flat look.
  - "Defeat" drops in over 420 ms.
- **Buttons** work at once in both cases. Nothing waits for an animation.

## Part 3 — Sound

**Which sounds play**
- Only events that involve the player make a sound.
- Trade ships and trade planes make none, because they launch too often.

| Sound | When | Source |
|---|---|---|
| `click` | Any button press | Kenney Interface `click_002` |
| `place` | A new building of yours appears, under construction | Kenney Interface `drop_002` |
| `built` | Your building is finished (`buildingDone`) | Kenney Interface `confirmation_001` |
| `send` | You start or add to an attack (`attackStarted`, attacker = you) | Made in code: a whoosh |
| `thud` | Your land grew in this update | Kenney Impact `impactSoft_medium_000`–`004`, picked in turn |
| `horn` | Your troop boat or warship sets sail (a new unit) | Made in code |
| `jet` | Your bomber, paratroop plane or fighter takes off (a new unit) | Made in code |
| `boom` | A bomb lands that you dropped or that hit you (`bombed`) | Kenney Sci-fi `lowFrequency_explosion_000`–`001` |
| `landing` | Your troops land from a boat or a drop (`landed`) | Kenney Impact `impactPunch_heavy_000` |
| `refused` | The game refuses your order (`rejected`) | Kenney Interface `error_004` |
| `warning` | Someone starts an attack on you (`attackStarted`, target = you) | Made in code: a two-tone alarm |
| `radar` | Your radar spots planes (`radarWarning`) | Made in code: a ping |
| `offer` | An offer arrives for you (`request`) | Kenney Interface `glass_002` |
| `accepted` | Your offer was accepted (`requestResolved`) | Kenney Interface `confirmation_002` |
| `declined` | Your offer was refused or ran out | Made in code: a low falling tone |
| `betrayal` | An ally betrays you (`betrayal`, victim = you) | Made in code: a sharp sting |
| `lost` | You lose a building (`buildingCaptured` from you, `buildingDestroyed` of yours) | Kenney Impact `impactMetal_heavy_000` |
| `warStart` | The spawn phase ends (`phase` → playing) | Kenney Impact `impactBell_heavy_000` |
| `knockout` | You knock a nation out (`eliminated`, by = you) | Made in code: a short rising flourish |
| `victory` | You win (`gameOver` with you among the winners) | Made in code: a fanfare |
| `defeat` | You lose (`gameOver` without you, or you are eliminated) | Made in code: a falling tune |

**Rules** (`src/client/audio/soundRules.ts` and `mixer.ts`, pure, Node-testable)
- **Minimum gaps** between repeats of the same sound:

  | Sound | Gap |
  |---|---|
  | `thud` | 330 ms (at most about 3 a second) |
  | `warning` | 2 s |
  | `radar` | 3 s |
  | `boom`, `send` | 150 ms |
  | Every other sound | 100 ms |

- At most 8 sounds play at once.
- **Volume:** action sounds play at 0.6 and alerts at 0.9, both multiplied by the volume slider.
- **Once per match:** `victory` and `defeat` each play at most once per match. A player who is knocked out and keeps watching doesn't hear `defeat` again at game over.
- **Pause:** game sounds don't play while the game is paused. Button clicks still do.
- **Hidden tab:** while the tab is hidden, the audio context is suspended.
- **New units and buildings** are found by comparing the ids in one update with the ids in the update before.
- **Growing land** is counted in `ClientState.applyUpdate`, together with the land lost (which the minimap uses).

**Controls and settings**
- A speaker button sits next to the pause button and toggles mute. A volume slider sits beside it.
- **Default:** sound on, at 50%.
- **Saved setting:** stored in `localStorage` under `borderline.sound` as `{ muted, volume }`. Every read and write is wrapped in `try/catch`, so the game works without storage.
- **Audio context:** browsers only allow sound after a click or key press. The context is created on the first press, which is normally the Play button.
- **Loading:**
  - The MP3s load and decode in the background.
  - A sound asked for before it has loaded is skipped.

**Where the sound files come from**
- `scripts/build-sounds.ts` builds them:
  - It downloads the four Kenney packs (pinned URLs) into `.cache/kenney/`, which git ignores.
  - It converts the chosen files with `ffmpeg` to mono 44.1 kHz MP3 at 96 kbps, trimming leading silence.
  - It renders the made-in-code sounds from `src/client/audio/synth.ts`. These are pure functions that return samples, and they're unit-tested. They become WAV files, then MP3.
- **Output:** `public/sounds/*.mp3` and `public/sounds/CREDITS.txt`.
- **Committed:** the MP3 files. CI doesn't rerun the script, which needs the network and `ffmpeg`.
- **Size limit:** under 500 KB in total. A unit test checks the size.
- **Licence:** the Kenney packs are CC0 (public domain). The README and `CREDITS.txt` credit Kenney anyway.

## Part 4 — Minimap

**Place and size**
- Bottom-right corner, just above the bottom bar, in a glass panel.
- At most 240×160 CSS px, keeping the map's shape.

**What it shows**
- **Picture:**
  - It is the flat territory picture: `TerritoryLayer`, one pixel per tile, in the natural palette.
  - It is scaled down smoothly.
  - It is repainted on updates, only in the dirty rectangle.
- **View box:** a white rectangle around the part of the map the camera shows, clipped to the minimap.
- **Danger flashes:** red rings, and orange rings for bombs you drop. At most 12 are shown at a time, each fading over 1.5 s.
  - Red where you lost land in an update. The lost tiles are grouped into 24×24-tile cells, one ring per cell.
  - Red where a bomb hits you.
  - Orange where your own bombs land.

**Controls**
- **Click or drag:** centres the camera on that point. The zoom doesn't change.
- **M key:** shows or hides the minimap. The choice is remembered in `localStorage`.

**Code**
- `src/client/ui/minimapGeometry.ts` — pure, Node-tested. It converts between map and minimap positions, works out the view box, and groups lost tiles into cells.
- `src/client/ui/minimap.ts` — the panel and its drawing.

## Part 5 — Testing, checks and delivery

**Unit tests** (Vitest, Node)
- **Terrain look:**
  - The coast distance's sign and values.
  - Snow follows latitude.
  - No forest on beaches, snow or mountains.
  - The same seed gives the same result.
- **Territory field:**
  - Owner bytes.
  - `edge` after updates equals a full recompute.
  - Capture times.
  - Dirty rectangles.
- **Snapshot:** `fronts` and the new init fields.
- **Sound:**
  - Rules: every row of the sound table.
  - Gaps, the limit on sounds at once, mute, volume, the pause gate, and the saved setting.
  - The new unit and building detectors.
  - The synth output: length, and peak ≤ 1.
- **Minimap geometry.**
- **Logo:** the favicon equals `badgeSvg()`.
- **Count-up:** the counting function.
- **Sound files:** the total size.

**Browser tests** (Playwright)
- **New map:** it draws.
  - Water samples blue.
  - The player's land samples tinted toward the player's colour.
  - `?look=flat` still works.
- **Menu:** the segmented buttons start a game, the logo shows, and the tab title is "Borderline".
- **Minimap:**
  - It's visible.
  - Clicking it moves the camera.
  - M hides it.
- **Sound:**
  - The mute button toggles and stays set after a reload.
  - The audio context is running after Play.
- **Victory screen:** it shows confetti and the counted stats.
- **Frame probe:** under the ceiling above.

**Checks before every push**
- `npm run typecheck`, `npm test`, `npm run build` and `npm run e2e`.
- **Before the final push,** also:
  - `npm run perf`, which now includes the territory-field budget.
  - `npm run arena -- --seeds 20 --size small`, which must still give 90% / 95% / 100%. The simulation's rules are untouched, so the results should be identical.

**Screenshots**
- `docs/screenshots/` gets the new look. The old screenshots are kept as `*-before.png` for the side-by-side.
- The user gets before-and-after screenshots at the end.

**Delivery**
- Commits go on `claude/clever-cray-5279az`, pushed when each milestone is done and green.
- **If pull request #2 is still open:** it carries Step B too, and its title and description are updated to say so.
- **If it was merged meanwhile:** Step B goes in a new pull request from a branch restarted on `main`.

## Decisions made without asking

These fill gaps the questions didn't cover. Each has a cost if wrong.

1. **Some sounds are made in code.** The whoosh, jet, horn, two-tone warning, radar ping, betrayal sting, low "declined" tone and the three tunes are made in code. The packs either don't have them or don't label their tunes by mood, and a sad tune on a win would be worse than a simple fanfare. *Cost if wrong:* the tunes sound plainer than recordings would. They're easy to swap later.
2. **Coasts get no border line or glow.** Only borders where land changes owner are drawn, empty land included. *Cost if wrong:* nations along a coast look a little less outlined.
3. **The title backdrop uses the real world map** with made-up nations. *Cost if wrong:* none to play. It's just the backdrop.
4. **The minimap uses the flat picture,** not the graphics-chip look. It's too small for the detail to show. *Cost if wrong:* the minimap looks simpler than the big map.
5. **A lost WebGL context switches to the flat look** for the rest of the match. *Cost if wrong:* rare. The game keeps working.
6. **The `?look=flat` switch** is kept for tests and comparisons. *Cost if wrong:* none.
7. **Front lines show only between two nations.** Spreading into empty land doesn't count. *Cost if wrong:* players see less movement in the early game.
