import { CONFIG } from '../../shared/config';
import type { Deal, DiplomacyRequest, NationId } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import { cancelAttacksBetween } from './attacks';

const fail = (reason: string): CommandResult => ({ ok: false, reason });

/** Why `from` can't address `to`, or null if it can: not itself, a real nation, still alive. */
function counterpartProblem(game: Game, from: NationId, to: NationId): string | null {
  if (to === from) return 'yourself';
  if (!Number.isInteger(to) || to < 1 || to >= game.nations.length) return 'unknown nation';
  if (!game.nations[to].alive) return 'eliminated';
  return null;
}

/**
 * Sends `to` a request of `kind` from `from`, open for `requestTtlTicks`, and emits `request`. Rejected for itself, an
 * unknown or dead nation, a request of the same kind from `from` to `to` still open, an alliance with an ally, and
 * peace without a war.
 */
export function createRequest(
  game: Game, kind: DiplomacyRequest['kind'], from: NationId, to: NationId, extra: { deal?: Deal; target?: NationId } = {},
): CommandResult {
  const problem = counterpartProblem(game, from, to);
  if (problem) return fail(problem);
  for (const r of game.requests.values()) {
    if (r.kind === kind && r.from === from && r.to === to) return fail('already proposed');
  }
  const relation = game.relations.get(from, to);
  if (kind === 'alliance' && relation === 'allied') return fail('already allied');
  if (kind === 'peace' && relation !== 'war') return fail('not at war');
  const request: DiplomacyRequest = { id: game.nextId(), kind, from, to, expiresAt: game.tick + CONFIG.diplomacy.requestTtlTicks, ...extra };
  game.requests.set(request.id, request);
  game.emit({ type: 'request', request });
  return { ok: true };
}

/**
 * `nation` answers request `requestId`, which must be addressed to it. An accepted alliance makes the pair allies and
 * ends every attack between them; accepted peace ends their war the same way (if they are still at war). The request
 * is resolved either way.
 */
export function respond(game: Game, nation: NationId, requestId: number, accept: boolean): CommandResult {
  const request = game.requests.get(requestId);
  if (!request) return fail('no such request');
  if (request.to !== nation) return fail('not addressed to you');
  game.requests.delete(requestId);
  if (accept) {
    const { from, to } = request;
    if (request.kind === 'alliance') makeRelation(game, from, to, 'allied');
    else if (request.kind === 'peace' && game.relations.get(from, to) === 'war') makeRelation(game, from, to, 'neutral');
  }
  resolve(game, request, accept);
  return { ok: true };
}

/** Sets the pair's relation, ends the attacks between them and emits `relation` if it changed. */
function makeRelation(game: Game, a: NationId, b: NationId, relation: 'allied' | 'neutral'): void {
  cancelAttacksBetween(game, a, b);
  if (game.relations.get(a, b) === relation) return;
  game.relations.set(a, b, relation);
  game.emit({ type: 'relation', a, b, relation });
}

function resolve(game: Game, request: DiplomacyRequest, accepted: boolean): void {
  const { id: requestId, kind, from, to } = request;
  game.emit({ type: 'requestResolved', requestId, kind, from, to, accepted });
}

/**
 * `nation` leaves its alliance with `other`; they are neutral. Every other nation's trust in the betrayer drops by
 * `betrayalTrustPenalty` (never below 0) and the victim's falls to 0. Emits `relation` and `betrayal`.
 */
export function breakAlliance(game: Game, nation: NationId, other: NationId): CommandResult {
  const problem = counterpartProblem(game, nation, other);
  if (problem) return fail(problem);
  if (game.relations.get(nation, other) !== 'allied') return fail('not allied');
  game.relations.set(nation, other, 'neutral');
  game.emit({ type: 'relation', a: nation, b: other, relation: 'neutral' });
  const { relations } = game;
  for (let t = 1; t < game.nations.length; t++) {
    if (t === nation || t === other) continue;
    relations.setTrust(t, nation, Math.max(0, relations.trust(t, nation) - CONFIG.diplomacy.betrayalTrustPenalty));
  }
  relations.setTrust(other, nation, 0);
  game.emit({ type: 'betrayal', betrayer: nation, victim: other });
  return { ok: true };
}

/** `nation` starts or lifts its embargo on `other`: no new trade between them while either side has one. */
export function setEmbargo(game: Game, nation: NationId, other: NationId, on: boolean): CommandResult {
  const problem = counterpartProblem(game, nation, other);
  if (problem && problem !== 'eliminated') return fail(problem);
  game.relations.setEmbargo(nation, other, on === true);
  return { ok: true };
}

/**
 * Once a tick: requests past their expiry, or to or from a nation no longer alive, are resolved as not accepted; every
 * nation's trust in every other moves `trustRecoveryPerTick` back toward `defaultTrust`.
 */
export function stepDiplomacy(game: Game): void {
  for (const request of [...game.requests.values()]) {
    if (game.tick < request.expiresAt && game.nations[request.from].alive && game.nations[request.to].alive) continue;
    game.requests.delete(request.id);
    resolve(game, request, false);
  }
  const { defaultTrust, trustRecoveryPerTick: step } = CONFIG.diplomacy;
  const { relations } = game;
  const n = game.nations.length;
  for (let a = 1; a < n; a++) {
    for (let b = 1; b < n; b++) {
      if (a === b) continue;
      const t = relations.trust(a, b);
      if (t === defaultTrust) continue;
      relations.setTrust(a, b, t < defaultTrust ? Math.min(defaultTrust, t + step) : Math.max(defaultTrust, t - step));
    }
  }
}
