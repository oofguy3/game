import { CONFIG } from '../../shared/config';
import type { Command, NationId, Phase } from '../../shared/types';
import { attackCommand } from '../systems/attacks';
import { build } from '../systems/buildings';
import { launchBoat } from '../systems/naval';
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

/**
 * Validates and applies one command on behalf of `cmd.nation`. Every rejection emits exactly one `rejected` event.
 * Later tasks replace the 'not implemented' cases with real handlers.
 */
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
    case 'buildUnit':
    case 'moveUnit':
    case 'bomb':
    case 'paradrop':
    case 'proposeAlliance':
    case 'breakAlliance':
    case 'proposePeace':
    case 'proposeDeal':
    case 'requestJointAttack':
    case 'respond':
    case 'embargo':
      return reject(game, nation, 'not implemented');
  }
}

function debugGrant(game: Game, cmd: Extract<Command, { type: 'debugGrant' }>): CommandResult {
  if (!game.debug) return reject(game, cmd.nation, 'debug commands are disabled');
  const nation = game.nations[cmd.nation];
  nation.gold += cmd.gold ?? 0;
  nation.troops += cmd.troops ?? 0;
  return { ok: true };
}
