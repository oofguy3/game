import { CONFIG } from '../../shared/config';
import type { AidRefusal, Deal, DiplomacyRequest, NationId } from '../../shared/types';
import type { CommandResult } from '../core/commands';
import type { Game } from '../core/game';
import { sameTeam } from '../core/teams';
import { cancelAttacksBetween } from './attacks';
import { pacedAsk } from './teamAid';
import { removeUnit } from './units';

const fail = (reason: string): CommandResult => ({ ok: false, reason });

/** Why `from` can't address `to`, or null if it can: not itself, a real nation, still alive. */
export function counterpartProblem(game: Game, from: NationId, to: NationId): string | null {
  if (to === from) return 'yourself';
  if (!Number.isInteger(to) || to < 1 || to >= game.nations.length) return 'unknown nation';
  if (!game.nations[to].alive) return 'eliminated';
  return null;
}

/** Whether `a` and `b` are both on teams, and not the same one. */
function onOtherTeams(game: Game, a: NationId, b: NationId): boolean {
  const ta = game.nations[a].team;
  const tb = game.nations[b].team;
  return ta > 0 && tb > 0 && ta !== tb;
}

/**
 * Sends `to` a request of `kind` from `from`, open for `requestTtlTicks`, and emits `request`. Rejected for itself, an
 * unknown or dead nation, an alliance when the rules have none, an alliance with a nation of another team, a request
 * of the same kind from `from` to `to` still open, an alliance with an ally, and peace without a war.
 */
export function createRequest(
  game: Game, kind: DiplomacyRequest['kind'], from: NationId, to: NationId,
  extra: Pick<DiplomacyRequest, 'deal' | 'target' | 'resource'> = {},
): CommandResult {
  const problem = counterpartProblem(game, from, to);
  if (problem) return fail(problem);
  if (kind === 'alliance' && !game.tuning.alliances) return fail('no alliances');
  if (kind === 'alliance' && onOtherTeams(game, from, to)) return fail('other team');
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
 * `nation` answers request `requestId`, which must be addressed to it. An accepted alliance makes the pair allies,
 * ends every attack between them and calls back the boats and planes on their way; accepted peace ends their war the
 * same way (if they are still at war); an accepted deal changes hands if both sides can still pay, else it resolves
 * as not accepted; an accepted joint attack or ask for help changes nothing by itself. The request is resolved either
 * way, passing on `reason` (why an ask for help was declined).
 */
export function respond(game: Game, nation: NationId, requestId: number, accept: boolean, reason?: AidRefusal): CommandResult {
  const request = game.requests.get(requestId);
  if (!request) return fail('no such request');
  if (request.to !== nation) return fail('not addressed to you');
  game.requests.delete(requestId);
  let accepted = accept;
  if (accept) {
    const { from, to } = request;
    if (request.kind === 'alliance') makeRelation(game, from, to, 'allied');
    else if (request.kind === 'peace' && game.relations.get(from, to) === 'war') makeRelation(game, from, to, 'neutral');
    else if (request.kind === 'deal' && request.deal) accepted = settleDeal(game, from, to, request.deal);
  }
  resolve(game, request, accepted, reason);
  return { ok: true };
}

/**
 * Offers `to` a deal: `from` gives `giveGold` and `giveTroops` for `getGold` and `getTroops` (a gift asks for nothing).
 * Every amount must be a finite number ≥ 0, not all 0, and `from` must be able to pay its side now.
 */
export function proposeDeal(game: Game, from: NationId, to: NationId, deal: Deal): CommandResult {
  const problem = counterpartProblem(game, from, to);
  if (problem) return fail(problem);
  const amounts = [deal?.giveGold, deal?.giveTroops, deal?.getGold, deal?.getTroops];
  if (!amounts.every((a) => typeof a === 'number' && Number.isFinite(a) && a >= 0) || !amounts.some((a) => a > 0)) {
    return fail('bad deal');
  }
  const short = shortfall(game, from, deal.giveGold, deal.giveTroops);
  if (short) return fail(short);
  const { giveGold, giveTroops, getGold, getTroops } = deal;
  return createRequest(game, 'deal', from, to, { deal: { giveGold, giveTroops, getGold, getTroops } });
}

/** What `nation` lacks to pay `gold` and `troops`, or null if it can. */
export function shortfall(game: Game, nation: NationId, gold: number, troops: number): string | null {
  const n = game.nations[nation];
  if (n.gold < gold) return 'not enough gold';
  if (n.troops < troops) return 'not enough troops';
  return null;
}

/** Carries out an accepted deal if both sides can still pay; whether it went through. */
function settleDeal(game: Game, from: NationId, to: NationId, deal: Deal): boolean {
  const a = game.nations[from];
  const b = game.nations[to];
  if (!a.alive || !b.alive) return false;
  if (shortfall(game, from, deal.giveGold, deal.giveTroops) || shortfall(game, to, deal.getGold, deal.getTroops)) return false;
  a.gold += deal.getGold - deal.giveGold;
  b.gold += deal.giveGold - deal.getGold;
  a.troops += deal.getTroops - deal.giveTroops;
  b.troops += deal.giveTroops - deal.getTroops;
  return true;
}

/**
 * Asks ally `to` to join an attack on `target`, a living nation allied to neither. Accepting is a promise: it changes
 * nothing by itself (bots act on it). Between teammates the asks are paced by `pacedAsk`.
 */
export function requestJointAttack(game: Game, from: NationId, to: NationId, target: NationId): CommandResult {
  const problem = counterpartProblem(game, from, to);
  if (problem) return fail(problem);
  if (game.relations.get(from, to) !== 'allied') return fail('not allied');
  if (!Number.isInteger(target) || target < 1 || target >= game.nations.length || target === from || target === to) {
    return fail('bad target');
  }
  if (!game.nations[target].alive) return fail('eliminated');
  if (game.relations.get(from, target) === 'allied' || game.relations.get(to, target) === 'allied') {
    return fail('target is an ally');
  }
  return pacedAsk(game, from, to, () => createRequest(game, 'jointAttack', from, to, { target }));
}

/** Sets the pair's relation, ends the attacks between them, calls off what is in flight and emits `relation` if it changed. */
function makeRelation(game: Game, a: NationId, b: NationId, relation: 'allied' | 'neutral'): void {
  cancelAttacksBetween(game, a, b);
  recallUnits(game, a, b);
  if (game.relations.get(a, b) === relation) return;
  game.relations.set(a, b, relation);
  game.emit({ type: 'relation', a, b, relation });
}

/**
 * Calls off what `a` and `b` have on the way to each other's land: troop boats and paratroop planes turn back (their
 * troops rejoin their owner's pool) and bombers fly home without dropping anything.
 */
function recallUnits(game: Game, a: NationId, b: NationId): void {
  for (const u of [...game.units.values()]) {
    const other = u.owner === a ? b : u.owner === b ? a : 0;
    if (other === 0 || u.targetTile < 0 || game.owner[u.targetTile] !== other) continue;
    if (u.type === 'troopBoat' || u.type === 'paraPlane') {
      removeUnit(game, u.id, 0);
      game.nations[u.owner].troops += u.troops;
    } else if (u.type === 'bomber' && u.mission !== 'returning') {
      const home = u.homeId === null ? undefined : game.buildings.byId.get(u.homeId);
      if (home && home.owner === u.owner && home.type === 'airport') {
        u.mission = 'returning';
        u.path = [home.tile];
        u.pathIndex = 0;
      } else removeUnit(game, u.id, 0);
    }
  }
}

function resolve(game: Game, request: DiplomacyRequest, accepted: boolean, reason?: AidRefusal): void {
  const { id: requestId, kind, from, to } = request;
  game.emit({ type: 'requestResolved', requestId, kind, from, to, accepted, ...(reason === undefined ? {} : { reason }) });
}

/**
 * `nation` leaves its alliance with `other`; they are neutral. Every other nation's trust in the betrayer drops by
 * `betrayalTrustPenalty` (never below 0) and the victim's falls to 0. Emits `relation` and `betrayal`. A teammate
 * can't be left.
 */
export function breakAlliance(game: Game, nation: NationId, other: NationId): CommandResult {
  const problem = counterpartProblem(game, nation, other);
  if (problem) return fail(problem);
  if (sameTeam(game, nation, other)) return fail('teammate');
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

/**
 * `nation` starts or lifts its embargo on `other`: no new trade between them while either side has one. An embargo
 * on a teammate can't be started.
 */
export function setEmbargo(game: Game, nation: NationId, other: NationId, on: boolean): CommandResult {
  const problem = counterpartProblem(game, nation, other);
  if (problem && problem !== 'eliminated') return fail(problem);
  if (on === true && sameTeam(game, nation, other)) return fail('teammate');
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
