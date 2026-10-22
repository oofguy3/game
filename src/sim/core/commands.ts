import type { Command, NationId } from '../../shared/types';
import type { Game } from './game';

export type CommandResult = { ok: true } | { ok: false; reason: string };

function reject(game: Game, nation: NationId, reason: string): CommandResult {
  game.emit({ type: 'rejected', nation, reason });
  return { ok: false, reason };
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

  switch (cmd.type) {
    case 'debugGrant':
      return debugGrant(game, cmd);
    case 'spawn':
    case 'attack':
    case 'boat':
    case 'build':
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
