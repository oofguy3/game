import { CONFIG } from '../../shared/config';
import type { AttackSupport, Command, NationId, TileIndex } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import { forEachNeighbor, isLand } from '../map/grid';
import { MaxHeap } from '../util/heap';
import { defenderLossPerTile, isTargetTile, tileCaptureCost } from './combat';
import { launchBoat } from './naval';
import { declareWar } from './relations';
import { teammateProblem } from './teamAid';

export interface Attack {
  id: number;
  attacker: NationId;
  /** 0 = unowned land. */
  target: NationId;
  troops: number;
  /** Target tiles next to the attacker, most-surrounded first. Entries `queued` doesn't match are stale and skipped. */
  frontier: MaxHeap;
  /** Each tile queued in `frontier`, with the priority of its live entry. Its size is the width of the front. */
  queued: Map<TileIndex, number>;
  /** Speed points carried between ticks; negative while a costly tile is still being paid off. */
  progress: number;
}

const fail = (reason: string): CommandResult => ({ ok: false, reason });

/** Whether some tile of `a`'s border has a 4-neighbour `a` could attack in `b`; with b = 0, unowned land. */
export function sharesBorder(game: Game, a: NationId, b: NationId): boolean {
  for (const t of game.nations[a].border) {
    if (touchesTarget(game, t, b)) return true;
  }
  return false;
}

/**
 * Sends `troops` from `attacker`'s pool against `target` (0 = unowned land). Rejected for the attacker itself, an
 * ally, a target with no shared border unless a `seedTile` (a beachhead the attacker holds) is given, and fewer than
 * one troop. The troops first cancel out against any attack the target has running against the attacker, both sides
 * losing the smaller amount; what is left joins the attacker's existing attack on the target, or starts a new one.
 * Either way every target tile touching the attacker's border or the seed tile joins the frontier, so land that has
 * come within reach since an attack began is taken too; with `seedOnly` (paratroopers) only the seed tile's. Attacking a nation declares war on it. Reports the reason on
 * failure without emitting `rejected`; `applyCommand` does that. `support` (already checked) goes out with
 * `attackStarted`.
 */
export function startAttack(
  game: Game, attacker: NationId, target: NationId, troops: number, seedTile?: TileIndex, seedOnly = false,
  support?: AttackSupport,
): CommandResult {
  if (target === attacker) return fail('own tile');
  if (target !== 0 && game.relations.get(attacker, target) === 'allied') return fail('allied');
  if (seedTile === undefined && !sharesBorder(game, attacker, target)) return fail('not adjacent');
  if (!(troops >= 1)) return fail('not enough troops');

  game.nations[attacker].troops -= troops;
  declareWar(game, attacker, target);
  game.emit({ type: 'attackStarted', attacker, target, troops, ...(support && { support }) });

  const remaining = troops - cancelCounterattack(game, attacker, target, troops);
  if (remaining <= 0) return { ok: true };

  let attack = game.attacks.find((a) => a.attacker === attacker && a.target === target);
  if (attack) {
    attack.troops += remaining;
  } else {
    attack = {
      id: game.nextId(), attacker, target, troops: remaining, frontier: new MaxHeap(), queued: new Map(), progress: 0,
    };
    game.attacks.push(attack);
  }
  if (!seedOnly) for (const b of game.nations[attacker].border) pushTargetNeighbours(game, attack, b);
  if (seedTile !== undefined) pushTargetNeighbours(game, attack, seedTile);
  return { ok: true };
}

/**
 * The `attack` command: attacks the owner of `cmd.tile` (or spreads into unowned land) with
 * floor(troops × ratio) troops, the ratio clamped to [`minAttackRatio`, 1]. With `allowBoat`, a target out of reach
 * over land is attacked by boat, landing on its nearest beach or free beach ('no beach' when there's none in reach).
 * The command's `support` goes out with `attackStarted` when its ally is a living teammate; otherwise it is dropped
 * and the attack goes ahead without it.
 */
export function attackCommand(game: Game, cmd: Extract<Command, { type: 'attack' }>): CommandResult {
  const { map } = game;
  const tile = cmd.tile;
  if (!Number.isInteger(tile) || tile < 0 || tile >= map.width * map.height) return fail('off the map');
  if (!isLand(map, tile)) return fail('not land');
  const ratio = Math.min(1, Math.max(CONFIG.combat.minAttackRatio, cmd.ratio));
  const troops = Math.floor(game.nations[cmd.nation].troops * ratio);
  const target = game.owner[tile];
  if (target !== 0 && target !== cmd.nation && game.relations.get(cmd.nation, target) === 'allied') return fail('allied');
  if (cmd.allowBoat && target !== cmd.nation && !reachableOverLand(game, cmd.nation, tile)) {
    const beach = nearestBeach(game, tile);
    return beach === null ? fail('no beach') : launchBoat(game, cmd.nation, beach, troops);
  }
  const support = checkedSupport(game, cmd.nation, cmd.support);
  return startAttack(game, cmd.nation, target, troops, undefined, false, support);
}

/** `support` as `attacker` may claim it — well formed, for a living teammate — or undefined. */
function checkedSupport(game: Game, attacker: NationId, support: AttackSupport | undefined): AttackSupport | undefined {
  if (!support || (support.kind !== 'join' && support.kind !== 'defend')) return undefined;
  const { ally, kind } = support;
  return teammateProblem(game, attacker, ally) === null ? { ally, kind } : undefined;
}

/** Tiles searched for a beach near an inland click. */
const BEACH_SEARCH = 4000;

/**
 * Where a boat aimed at `tile` should land: the coastal tile nearest it (breadth-first over its landmass) that belongs
 * to `tile`'s owner or to no one, so the landing never hits a third nation; `tile` itself when it qualifies; null if
 * none is within reach.
 */
function nearestBeach(game: Game, tile: TileIndex): TileIndex | null {
  const { map } = game;
  const target = game.owner[tile];
  const landable = (t: TileIndex): boolean => map.coastal[t] === 1 && (game.owner[t] === target || game.owner[t] === 0);
  const queue: TileIndex[] = [tile];
  const seen = new Set<TileIndex>(queue);
  for (let i = 0; i < queue.length && queue.length < BEACH_SEARCH; i++) {
    const t = queue[i];
    if (landable(t)) return t;
    forEachNeighbor(map, t, (n) => {
      if (!seen.has(n) && isLand(map, n)) {
        seen.add(n);
        queue.push(n);
      }
    });
  }
  return null;
}

/**
 * Whether an attack over land can reach `tile`: for a nation, when we share a border with it; for free land, when we
 * hold land on its landmass that touches free land.
 */
function reachableOverLand(game: Game, nation: NationId, tile: TileIndex): boolean {
  const target = game.owner[tile];
  if (target !== 0) return sharesBorder(game, nation, target);
  const { landmass } = game.map;
  for (const b of game.nations[nation].border) {
    if (landmass[b] === landmass[tile] && touchesTarget(game, b, 0)) return true;
  }
  return false;
}

/**
 * Troops arriving at `tile` by sea or air. On the nation's own or an ally's tile they rejoin the pool. Anywhere else
 * they must pay the tile's capture cost (or are lost); the tile is taken and the rest attack its previous owner from
 * there (only from there with `seedOnly`). Landing on a nation's tile declares war on it.
 */
export function landTroops(game: Game, nation: NationId, tile: TileIndex, troops: number, seedOnly = false): void {
  const lander = game.nations[nation];
  if (!lander.alive) return;
  if (!isLand(game.map, tile)) {
    lander.troops += troops;
    return;
  }
  const owner = game.owner[tile];
  if (owner === nation || (owner !== 0 && game.relations.get(nation, owner) === 'allied')) {
    lander.troops += troops;
    return;
  }
  declareWar(game, nation, owner);
  const cost = tileCaptureCost(game, nation, tile);
  if (troops < cost) return;
  captureTile(game, nation, tile);
  game.emit({ type: 'landed', nation, tile, troops });
  const rest = troops - cost;
  // the rest joins the pool; a new attack draws it straight back out
  lander.troops += rest;
  if (rest >= 1 && (owner === 0 || game.nations[owner].alive)) startAttack(game, nation, owner, rest, tile, seedOnly);
}

/**
 * Advances every attack by one tick. Each earns speed points from the width of its front (its queued tiles), clamped to
 * [`minTilesPerTick`, `maxTilesPerTick`], and spends them on tiles at their terrain cost, highest priority first; a
 * shortfall carries over as debt. An attack ends, returning its troops, when its frontier runs dry, it can't pay for
 * the next tile, or its target is eliminated.
 */
export function stepAttacks(game: Game): void {
  for (const attack of game.attacks.slice()) {
    // attacks of a nation eliminated earlier this tick are already gone
    if (!game.nations[attack.attacker].alive) continue;
    if (!advance(game, attack)) endAttack(game, attack);
  }
}

/** Ends the attacks between `a` and `b` in both directions and returns their troops. */
export function cancelAttacksBetween(game: Game, a: NationId, b: NationId): void {
  for (const attack of game.attacks.slice()) {
    if ((attack.attacker === a && attack.target === b) || (attack.attacker === b && attack.target === a)) {
      endAttack(game, attack);
    }
  }
}

/** One tick of `attack`; false once it is over. */
function advance(game: Game, attack: Attack): boolean {
  const { frontFraction, minTilesPerTick, maxTilesPerTick, terrainCost } = CONFIG.combat;
  if (!targetAlive(game, attack)) return false;
  compactFrontier(attack);
  attack.progress += Math.min(maxTilesPerTick, Math.max(minTilesPerTick, attack.queued.size * frontFraction));
  while (attack.progress > 0) {
    const tile = popFrontier(game, attack);
    if (tile === undefined) return false;
    const cost = tileCaptureCost(game, attack.attacker, tile);
    if (attack.troops < cost) return false;
    attack.troops -= cost;
    attack.progress -= terrainCost[game.map.terrain[tile]];
    captureTile(game, attack.attacker, tile);
    if (!targetAlive(game, attack)) return false;
    pushTargetNeighbours(game, attack, tile);
  }
  return true;
}

/**
 * Gives `tile` to `attacker`: its owner loses troops for it first, and is eliminated if it was the last tile.
 * Elimination drops the loser's own attacks, troops and all.
 */
function captureTile(game: Game, attacker: NationId, tile: TileIndex): void {
  const from = game.owner[tile];
  if (from !== 0) {
    const defender = game.nations[from];
    defender.troops -= Math.min(defender.troops, defenderLossPerTile(game, tile));
  }
  game.setOwner(tile, attacker);
  game.nations[attacker].stats.tilesCaptured++;
  if (from !== 0 && game.nations[from].tiles === 0) {
    game.nations[from].alive = false;
    removeAttacks(game, (a) => a.attacker === from);
    for (const [id, u] of game.units) if (u.owner === from) game.units.delete(id);
    game.emit({ type: 'eliminated', nation: from, by: attacker });
  }
}

/** Removes `attack` and returns its troops to the attacker. */
function endAttack(game: Game, attack: Attack): void {
  removeAttacks(game, (a) => a === attack);
  const attacker = game.nations[attack.attacker];
  if (attacker.alive) attacker.troops += attack.troops;
}

/**
 * Cancels an attack `target` has running against `attacker` with `troops` just sent the other way: both lose the
 * smaller amount, and the other attack is removed once it has nothing left. Returns the troops lost on each side.
 */
function cancelCounterattack(game: Game, attacker: NationId, target: NationId, troops: number): number {
  const counter = game.attacks.find((a) => a.attacker === target && a.target === attacker);
  if (!counter) return 0;
  const lost = Math.min(troops, counter.troops);
  counter.troops -= lost;
  if (counter.troops <= 0) removeAttacks(game, (a) => a === counter);
  return lost;
}

function removeAttacks(game: Game, matches: (a: Attack) => boolean): void {
  const attacks = game.attacks;
  let kept = 0;
  for (const a of attacks) if (!matches(a)) attacks[kept++] = a;
  attacks.length = kept;
}

function targetAlive(game: Game, attack: Attack): boolean {
  return attack.target === 0 || game.nations[attack.target].alive;
}

/**
 * Dequeues frontier tiles, highest priority first, until one is still the target's and still touches the attacker;
 * undefined when none is. Entries superseded by a later, higher one for the same tile are skipped.
 */
function popFrontier(game: Game, attack: Attack): TileIndex | undefined {
  const { frontier, queued } = attack;
  while (frontier.size > 0) {
    const priority = frontier.peekPriority();
    const t = frontier.pop() as TileIndex;
    if (queued.get(t) !== priority) continue;
    queued.delete(t);
    if (game.owner[t] === attack.target && countOwnedNeighbours(game, t, attack.attacker) > 0) return t;
  }
  return undefined;
}

/** Rebuilds `attack.frontier` from its live entries once the stale ones outnumber them. */
function compactFrontier(attack: Attack): void {
  const { frontier, queued } = attack;
  if (frontier.size <= 2 * queued.size) return;
  frontier.clear();
  for (const [t, priority] of queued) frontier.push(t, priority);
}

function pushTargetNeighbours(game: Game, attack: Attack, tile: TileIndex): void {
  forEachNeighbor(game.map, tile, (t) => {
    if (isTargetTile(game, t, attack.target)) pushFrontier(game, attack, t);
  });
}

/**
 * Queues `tile` with priority = attacker-owned 4-neighbours + a random tie-break in [0, `frontierJitter`), drawn from
 * `game.rng`. A tile already queued is queued again only once its neighbour count exceeds its queued priority, which
 * leaves the old entry stale; otherwise nothing changes and no random number is drawn.
 */
function pushFrontier(game: Game, attack: Attack, tile: TileIndex): void {
  const owned = countOwnedNeighbours(game, tile, attack.attacker);
  const queuedPriority = attack.queued.get(tile);
  if (queuedPriority !== undefined && owned <= queuedPriority) return;
  const priority = owned + game.rng.next() * CONFIG.combat.frontierJitter;
  attack.queued.set(tile, priority);
  attack.frontier.push(tile, priority);
}

function countOwnedNeighbours(game: Game, t: TileIndex, owner: NationId): number {
  const { width, height } = game.map;
  const owners = game.owner;
  const x = t % width;
  let count = 0;
  if (t >= width && owners[t - width] === owner) count++;
  if (x > 0 && owners[t - 1] === owner) count++;
  if (x < width - 1 && owners[t + 1] === owner) count++;
  if (t < width * (height - 1) && owners[t + width] === owner) count++;
  return count;
}

/** Whether some 4-neighbour of `t` is a tile an attack on `target` could take. */
function touchesTarget(game: Game, t: TileIndex, target: NationId): boolean {
  const { width, height } = game.map;
  const x = t % width;
  return (t >= width && isTargetTile(game, t - width, target))
    || (x > 0 && isTargetTile(game, t - 1, target))
    || (x < width - 1 && isTargetTile(game, t + 1, target))
    || (t < width * (height - 1) && isTargetTile(game, t + width, target));
}
