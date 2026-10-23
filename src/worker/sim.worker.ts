import { CONFIG } from '../shared/config';
import { generateRandomMap } from '../sim/map/randomMap';
import { decodeWorldMap } from '../sim/map/worldMap';
import { Match } from '../sim/match';
import { buildInit, buildUpdate } from '../sim/snapshot';
import type { FromWorker, StartOptions, ToWorker } from './protocol';
import { TickScheduler } from './scheduler';

// Runs the simulation off the page's main thread so heavy AI turns never freeze the screen.

const ctx = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};

/** How often the worker checks whether ticks are due. */
const FRAME_MS = 16;
const MAX_BOTS = 40;

let match: Match | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const scheduler = new TickScheduler(CONFIG.tickMs, CONFIG.client.maxCatchUpTicks);

ctx.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'start') start(msg.options, msg.worldMap);
    else if (msg.type === 'command') match?.queuePlayer(msg.command);
    else if (msg.type === 'speed') scheduler.setSpeed(msg.speed);
  } catch (err) {
    fail(err);
  }
};

function start(options: StartOptions, worldMap?: ArrayBuffer): void {
  if (match) return;
  const map = options.map.kind === 'world'
    ? decodeWorldMap(new Uint8Array(worldMap ?? new ArrayBuffer(0)))
    : generateRandomMap(options.map.seed, options.map.size);
  const bots = Math.min(MAX_BOTS, Math.max(1, Math.floor(options.bots)));
  match = new Match({
    map,
    seed: options.seed,
    player: { name: options.playerName },
    bots: Array.from({ length: bots }, () => ({ difficulty: options.difficulty })),
    debug: options.debug,
  });
  const init = buildInit(match);
  ctx.postMessage({ type: 'init', init }, [init.terrain.buffer]);
  sendUpdate(match);
  timer = setInterval(frame, FRAME_MS);
}

function frame(): void {
  if (!match) return;
  try {
    const n = scheduler.due(performance.now());
    for (let i = 0; i < n; i++) match.step();
    if (n > 0) sendUpdate(match);
    if (match.game.phase === 'ended') stopTicking();
  } catch (err) {
    fail(err);
  }
}

function sendUpdate(m: Match): void {
  const update = buildUpdate(m);
  ctx.postMessage({ type: 'update', update }, [update.changedTiles.buffer, update.changedOwners.buffer]);
}

function stopTicking(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function fail(err: unknown): void {
  stopTicking();
  ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
}
