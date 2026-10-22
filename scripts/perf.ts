// Tick budget check: the world map, 30 insane bots, no player. Warms up, then times Match.step() calls.
// Usage: npm run perf [-- --ticks 3000 --warmup 200 --bots 30]
import { readFileSync } from 'node:fs';
import { decodeWorldMap } from '../src/sim/map/worldMap';
import { Match } from '../src/sim/match';

const BUDGET_MS = 20;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const ticks = arg('ticks', 3000);
const warmup = arg('warmup', 200);
const bots = arg('bots', 30);

const map = decodeWorldMap(new Uint8Array(readFileSync(new URL('../public/maps/world.bin', import.meta.url))));
const match = new Match({
  map, seed: 1, player: null, spawnTicks: 1, checkVictory: false,
  bots: Array.from({ length: bots }, () => ({ difficulty: 'insane' as const })),
});
const { game } = match;
const drain = (): void => {
  game.drainEvents();
  game.drainChangedTiles();
};
for (let i = 0; i < warmup; i++) {
  match.step();
  drain();
}

const times: number[] = [];
for (let i = 0; i < ticks; i++) {
  const start = performance.now();
  match.step();
  times.push(performance.now() - start);
  drain();
}

times.sort((a, b) => a - b);
const mean = times.reduce((s, t) => s + t, 0) / times.length;
const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
const max = times[times.length - 1];
const alive = game.nations.filter((n) => n.alive && n.id !== 0).length;
console.log(`perf: world map ${map.width}×${map.height}, ${bots} insane bots, ${ticks} ticks after ${warmup} warm-up`);
console.log(`mean ${mean.toFixed(2)} ms  p95 ${p95.toFixed(2)} ms  max ${max.toFixed(2)} ms  (budget ${BUDGET_MS} ms; ${alive} nations alive, ${game.units.size} units, ${game.buildings.byId.size} buildings at the end)`);
if (mean >= BUDGET_MS) {
  console.log('OVER BUDGET');
  process.exit(1);
}
