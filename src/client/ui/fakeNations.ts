import { Rng } from '../../sim/util/rng';

/** Made-up nations start at least this far (tiles) apart. */
const MIN_GAP = 4;
const SEED_TRIES = 200;

/**
 * Made-up nations for the title screen's backdrop: `count` nations (ids 1…count) start on random land tiles and take
 * turns claiming a random tile from the edge of their land until `share` of all land is owned or none can grow.
 * Returns the owner of each tile (0 for nobody). Deterministic for a seed.
 */
export function growNations(width: number, height: number, terrain: Uint8Array, count: number, share: number, seed: number): Uint16Array {
  const rng = new Rng(seed);
  const owner = new Uint16Array(width * height);
  const land: number[] = [];
  for (let t = 0; t < terrain.length; t++) if (terrain[t] !== 0) land.push(t);
  const target = Math.ceil(land.length * share);
  const frontiers: number[][] = [];
  const starts: number[] = [];
  for (let id = 1; id <= count && land.length > 0; id++) {
    for (let attempt = 0; attempt < SEED_TRIES; attempt++) {
      const t = land[rng.int(0, land.length - 1)];
      const x = t % width;
      const y = (t - x) / width;
      const crowded = owner[t] !== 0 || starts.some((s) => Math.max(Math.abs((s % width) - x), Math.abs(Math.floor(s / width) - y)) < MIN_GAP);
      if (crowded && attempt < SEED_TRIES - 1) continue;
      if (owner[t] !== 0) break;
      owner[t] = id;
      starts.push(t);
      frontiers[id] = [t];
      break;
    }
  }
  let owned = starts.length;
  let growing = true;
  while (owned < target && growing) {
    growing = false;
    for (let id = 1; id <= count && owned < target; id++) {
      const frontier = frontiers[id];
      // claim a random free neighbour of a random edge tile; edge tiles with no free neighbour drop out
      while (frontier && frontier.length > 0) {
        const i = rng.int(0, frontier.length - 1);
        const t = frontier[i];
        const free = neighbours(t, width, height).filter((m) => terrain[m] !== 0 && owner[m] === 0);
        if (free.length === 0) {
          frontier[i] = frontier[frontier.length - 1];
          frontier.pop();
          continue;
        }
        const m = free[rng.int(0, free.length - 1)];
        owner[m] = id;
        frontier.push(m);
        owned++;
        growing = true;
        break;
      }
    }
  }
  return owner;
}

function neighbours(t: number, width: number, height: number): number[] {
  const x = t % width;
  const out: number[] = [];
  if (x > 0) out.push(t - 1);
  if (x < width - 1) out.push(t + 1);
  if (t >= width) out.push(t - width);
  if (t < width * (height - 1)) out.push(t + width);
  return out;
}
