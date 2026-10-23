// Budget check on the world map with 30 insane bots and no player. Warms up, then times each Match.step() and, as the
// page would, each TerritoryField.apply() of that tick's changed tiles. Also times building the terrain look once.
// Usage: npm run perf [-- --ticks 3000 --warmup 200 --bots 30]
import { readFileSync } from 'node:fs';
import { buildTerrainLook } from '../src/client/render/look/terrainLook';
import { TerritoryField } from '../src/client/render/look/territoryField';
import { decodeWorldMap } from '../src/sim/map/worldMap';
import { Match } from '../src/sim/match';
import { lookOptions } from '../src/sim/snapshot';

const BUDGET_MS = 20;
const FIELD_BUDGET_MS = 2;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const ticks = arg('ticks', 3000);
const warmup = arg('warmup', 200);
const bots = arg('bots', 30);

const map = decodeWorldMap(new Uint8Array(readFileSync(new URL('../public/maps/world.bin', import.meta.url))));
const lookStart = performance.now();
buildTerrainLook(map.width, map.height, map.terrain, lookOptions({ kind: 'world' }));
const lookMs = performance.now() - lookStart;

const match = new Match({
  map, seed: 1, player: null, spawnTicks: 1, checkVictory: false,
  bots: Array.from({ length: bots }, () => ({ difficulty: 'insane' as const })),
});
const { game } = match;
const field = new TerritoryField(map.width, map.height, map.terrain);
/** Drains the tick's events and changed tiles; returns how long the field took to take the tiles in. */
const drain = (now: number): number => {
  game.drainEvents();
  const tiles = game.drainChangedTiles();
  const start = performance.now();
  field.apply(game.owner, tiles, now);
  return performance.now() - start;
};
for (let i = 0; i < warmup; i++) {
  match.step();
  drain(i / 10);
}

const times: number[] = [];
const fieldTimes: number[] = [];
for (let i = 0; i < ticks; i++) {
  const start = performance.now();
  match.step();
  times.push(performance.now() - start);
  fieldTimes.push(drain((warmup + i) / 10));
}

/** Mean, p95 and max of `values`, sorting them. */
function stats(values: number[]): { mean: number; p95: number; max: number } {
  values.sort((a, b) => a - b);
  return {
    mean: values.reduce((s, t) => s + t, 0) / values.length,
    p95: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))],
    max: values[values.length - 1],
  };
}
const step = stats(times);
const apply = stats(fieldTimes);
const alive = game.nations.filter((n) => n.alive && n.id !== 0).length;
console.log(`perf: world map ${map.width}×${map.height}, ${bots} insane bots, ${ticks} ticks after ${warmup} warm-up`);
console.log(`step:  mean ${step.mean.toFixed(2)} ms  p95 ${step.p95.toFixed(2)} ms  max ${step.max.toFixed(2)} ms  (budget ${BUDGET_MS} ms; ${alive} nations alive, ${game.units.size} units, ${game.buildings.byId.size} buildings at the end)`);
console.log(`field: mean ${apply.mean.toFixed(2)} ms  p95 ${apply.p95.toFixed(2)} ms  max ${apply.max.toFixed(2)} ms  (budget ${FIELD_BUDGET_MS} ms)`);
console.log(`terrain look: ${lookMs.toFixed(0)} ms once per map`);
let over = false;
if (step.mean >= BUDGET_MS) {
  console.log('STEP OVER BUDGET');
  over = true;
}
if (apply.mean >= FIELD_BUDGET_MS) {
  console.log('FIELD OVER BUDGET');
  over = true;
}
if (over) process.exit(1);
