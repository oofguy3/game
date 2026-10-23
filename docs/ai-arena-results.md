# AI arena results

Bots-only matches between neighbouring difficulties: 4 bots per side, interleaved ids, random maps, up to 6,000 ticks.
A match goes to the winner's difficulty (for a shared alliance win, the winner holding the most land); a match still
running at 6,000 ticks goes to the biggest nation. "At max" is the share of a side's living ticks spent above 95% of
its troop cap (troops there barely grow).

Target: each harder difficulty wins at least 70% of its matches on both runs, and insane bots spend under 10% of their
time at max.

## Final (2026-10-23)

`npm run arena -- --seeds 20 --size small`

| Pairing | Wins | Losses | Draws | Win rate | At max (harder / easier) |
|---|---|---|---|---|---|
| insane vs hard | 18 | 2 | 0 | **90%** | 2% / 2% |
| hard vs normal | 19 | 1 | 0 | **95%** | 4% / 6% |
| normal vs easy | 20 | 0 | 0 | **100%** | 35% / 14% |

`npm run arena -- --seeds 10 --size medium`

| Pairing | Wins | Losses | Draws | Win rate | At max (harder / easier) |
|---|---|---|---|---|---|
| insane vs hard | 9 | 1 | 0 | **90%** | 7% / 4% |
| hard vs normal | 9 | 1 | 0 | **90%** | 9% / 13% |
| normal vs easy | 10 | 0 | 0 | **100%** | 38% / 18% |

Ten more medium seeds (11–20) during tuning gave 90% / 100% / 100%.

## Before tuning

| Pairing | Small (20) | Medium (10) | Insane at max |
|---|---|---|---|
| insane vs hard | 30% | 30% | 43% / 19% |
| hard vs normal | 85% | 60% | |
| normal vs easy | 75% | 20% | |

## What changed

No bot got any extra resources; every change is in how bots decide.

1. **No expansion below the troop band.** Bots used to keep sending half their troops into free land however low they
   ran. Troop growth is proportional to the troops held when far below the cap, so a drained nation stalls; easy bots,
   which hoard, out-grew normal ones. Now nothing goes below the band floor (or the reserve).
2. **Surplus troops always find work.** Above the band, a target is worth attacking for any gain at all (the
   `minAttackScore` floor only applies inside the band). Late in a game every nation is dense, so each tile costs
   hundreds of troops and nothing passed the floor: matches froze with everyone at the cap.
3. **Saturated bots stop pacing.** At 90% of the cap (`saturatedRatio`) each target gets at least a third of the budget
   instead of only what its front can use before the next decision.
4. **The reserve is capped** at 80% of the cap (`reserveCap`). Against an overwhelming neighbour the reserve used to
   claim every troop forever.
5. **Insane's lookahead counts the troops actually sent** and discounts a target's score by the share of land another
   war could take meanwhile (`× (1 − risk)`, `counterRiskWeight` 1), instead of subtracting a risk computed as if the
   whole budget left. The old version vetoed most attacks and made insane the weakest level.
6. **No boxing in.** A bot refuses an alliance that would leave it nothing to take by land, and a bot that betrays
   (hard, insane) breaks with its weakest-defended ally when boxed in by allies with troops piling up.
7. **Arena scoring:** an alliance victory is credited to the biggest winner, not the lowest id.

Normal bots still sit at the cap a third of the time: their band tops out at 80%, and they are meant to be the easier
opponent.
