// Plays bots-only matches between neighbouring difficulties and checks each harder one wins often enough.
// Usage: npm run arena -- [--seeds 20] [--size small|medium|large] [--per-team 4] [--max-ticks 6000]
import type { Difficulty, MapSize } from '../src/shared/types';
import { headToHead } from '../src/sim/arena';

const TARGET_RATE = 0.7;
const PAIRS: [Difficulty, Difficulty][] = [['insane', 'hard'], ['hard', 'normal'], ['normal', 'easy']];

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const seedCount = Number(option('seeds', '20'));
const size = option('size', 'small') as MapSize;
const perTeam = Number(option('per-team', '4'));
const maxTicks = Number(option('max-ticks', '6000'));
if (!['small', 'medium', 'large'].includes(size) || !(seedCount > 0) || !(perTeam > 0) || !(maxTicks > 0)) {
  console.error('usage: npm run arena -- [--seeds N] [--size small|medium|large] [--per-team N] [--max-ticks N]');
  process.exit(2);
}
const seeds = Array.from({ length: seedCount }, (_, i) => i + 1);

console.log(`arena: ${seedCount} seeds, ${size} maps, ${perTeam} bots per side, up to ${maxTicks} ticks\n`);
console.log('pairing           wins  losses  draws  rate   at-max (a / b)');
let failed = false;
for (const [a, b] of PAIRS) {
  const started = performance.now();
  const r = headToHead(a, b, seeds, size, perTeam, maxTicks);
  const atMax = `${pct(r.timeAtMaxShare[a] ?? 0)} / ${pct(r.timeAtMaxShare[b] ?? 0)}`;
  const ok = r.rateA >= TARGET_RATE;
  if (!ok) failed = true;
  const secs = ((performance.now() - started) / 1000).toFixed(0);
  console.log(
    `${`${a} vs ${b}`.padEnd(17)} ${String(r.aWins).padStart(4)}  ${String(r.bWins).padStart(6)}  ` +
      `${String(r.draws).padStart(5)}  ${pct(r.rateA).padStart(5)}  ${atMax}  ${ok ? 'ok' : 'BELOW TARGET'} (${secs}s)`,
  );
}
console.log(`\ntarget: each harder difficulty wins at least ${pct(TARGET_RATE)} of its matches`);
process.exit(failed ? 1 : 0);

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
