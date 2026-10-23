import { CONFIG } from '../../shared/config';
import type { Command, NationId, Phase } from '../../shared/types';
import { buildFighter, launchBomber, launchParatroopers } from '../systems/air';
import { attackCommand } from '../systems/attacks';
import { build } from '../systems/buildings';
import { breakAlliance, createRequest, proposeDeal, requestJointAttack, respond, setEmbargo } from '../systems/diplomacy';
import { buildWarship, launchBoat, moveWarship } from '../systems/naval';
import { spawnNation } from '../systems/spawn';
import type { Game } from './game';

export type CommandResult = { ok: true } | { ok: false; reason: string };

function reject(game: Game, nation: NationId, reason: string): CommandResult {
  game.emit({ type: 'rejected', nation, reason });
  return { ok: false, reason };
}

/**
 * Whether a command type may be applied in `phase`: nothing once the game has ended, only `spawn` (and the debug
 * command) while nations choose their starts, and everything but `spawn` once play begins.
 */
function allowedInPhase(type: Command['type'], phase: Phase): boolean {
  switch (phase) {
    case 'spawn':
      return type === 'spawn' || type === 'debugGrant';
    case 'playing':
      return type !== 'spawn';
    case 'ended':
      return false;
  }
}

/** Validates and applies one command on behalf of `cmd.nation`. Every rejection emits exactly one `rejected` event. */
export function applyCommand(game: Game, cmd: Command): CommandResult {
  const nation = cmd.nation;
  if (!Number.isInteger(nation) || nation < 1 || nation >= game.nations.length) {
    return reject(game, nation, 'unknown nation');
  }
  if (!game.nations[nation].alive) return reject(game, nation, 'eliminated');
  if (!allowedInPhase(cmd.type, game.phase)) return reject(game, nation, 'wrong phase');

  switch (cmd.type) {
    case 'debugGrant':
      return debugGrant(game, cmd);
    case 'spawn': {
      const result = spawnNation(game, game.nations[nation], cmd.tile);
      return result.ok ? result : reject(game, nation, result.reason);
    }
    case 'attack': {
      const result = attackCommand(game, cmd);
      return result.ok ? result : reject(game, nation, result.reason);
    }
    case 'build': {
      const result = build(game, cmd);
      return result.ok ? result : reject(game, nation, result.reason);
    }
    case 'boat': {
      const ratio = Math.min(1, Math.max(CONFIG.combat.minAttackRatio, cmd.ratio));
      const result = launchBoat(game, nation, cmd.tile, Math.floor(game.nations[nation].troops * ratio));
      return result.ok ? result : reject(game, nation, result.reason);
    }
    case 'buildUnit': {
      const result = cmd.unit === 'warship' ? buildWarship(game, nation, cmd.buildingId) : buildFighter(game, nation, cmd.buildingId);
      return result.ok ? result : reject(game, nation, result.reason);
    }
    case 'bomb': {
      const result = launchBomber(game, nation, cmd.tile);
      return result.ok ? result : reject(game, nation, result.reason);
    }
    case 'paradrop': {
      const result = launchParatroopers(game, nation, cmd.tile, cmd.ratio);
      return result.ok ? result : reject(game, nation, result.reason);
    }
    case 'moveUnit': {
      const result = moveWarship(game, nation, cmd.unitId, cmd.tile);
      return result.ok ? result : reject(game, nation, result.reason);
    }
    case 'proposeAlliance':
      return settle(game, nation, createRequest(game, 'alliance', nation, cmd.to));
    case 'proposePeace':
      return settle(game, nation, createRequest(game, 'peace', nation, cmd.to));
    case 'breakAlliance':
      return settle(game, nation, breakAlliance(game, nation, cmd.with));
    case 'respond':
      return settle(game, nation, respond(game, nation, cmd.requestId, cmd.accept));
    case 'embargo':
      return settle(game, nation, setEmbargo(game, nation, cmd.with, cmd.on));
    case 'proposeDeal':
      return settle(game, nation, proposeDeal(game, nation, cmd.to, cmd.deal));
    case 'requestJointAttack':
      return settle(game, nation, requestJointAttack(game, nation, cmd.to, cmd.target));
  }
}

/** Passes `result` on, emitting `rejected` when it is a failure. */
function settle(game: Game, nation: NationId, result: CommandResult): CommandResult {
  return result.ok ? result : reject(game, nation, result.reason);
}

function debugGrant(game: Game, cmd: Extract<Command, { type: 'debugGrant' }>): CommandResult {
  if (!game.debug) return reject(game, cmd.nation, 'debug commands are disabled');
  const nation = game.nations[cmd.nation];
  nation.gold += cmd.gold ?? 0;
  nation.troops += cmd.troops ?? 0;
  return { ok: true };
}
