import type { NationId } from '../../shared/types';
import type { Game } from '../core/game';

/**
 * Whether `id` still has the opening shield. Tribes never do. The shield lasts until `protectUntil`, and ends early
 * when the nation attacks another nation.
 */
export function isShielded(game: Game, id: NationId): boolean {
  if (id <= 0 || id >= game.nations.length) return false;
  const n = game.nations[id];
  return n.role !== 'tribe' && n.shield && game.tick < game.protectUntil;
}

/** Why an attack on `target` is refused, or null when it may go ahead. */
export function shieldBlock(game: Game, target: NationId): string | null {
  return target !== 0 && isShielded(game, target) ? 'protected' : null;
}

/**
 * Attacking another nation spends the attacker's opening shield. Empty land and tribes do not: farming them is what
 * the shield is for.
 */
export function commitHostility(game: Game, attacker: NationId, target: NationId): void {
  if (target <= 0 || target >= game.nations.length) return;
  if (game.nations[target].role === 'tribe') return;
  game.nations[attacker].shield = false;
}
