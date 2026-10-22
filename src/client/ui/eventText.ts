import type { DiplomacyRequest, GameEvent, NationId } from '../../shared/types';
import { formatNumber } from '../format';
import { BUILDING_LABELS, UNIT_LABELS } from './labels';

const REQUEST_LABELS: Record<DiplomacyRequest['kind'], string> = {
  alliance: 'alliance offer',
  peace: 'peace offer',
  deal: 'deal',
  jointAttack: 'call to attack',
};

/** A one-line description of `e` for the player `me`, or null when it isn't worth a line in the feed. */
export function describeEvent(e: GameEvent, names: Map<NationId, string>, me: NationId): string | null {
  const n = (id: NationId): string => (id === me ? 'you' : names.get(id) ?? 'Someone');
  const line = ((): string | null => {
    switch (e.type) {
      case 'attackStarted':
        if (e.target === 0) return null;
        if (e.attacker === me) return `you attacked ${n(e.target)}`;
        return e.target === me ? `${n(e.attacker)} attacked you` : null;
      case 'buildingDone':
        return `${BUILDING_LABELS[e.building]} complete`;
      case 'landed':
        return 'your boat landed';
      case 'eliminated':
        if (e.nation === me) return `${n(e.by)} wiped you out`;
        return `${n(e.by)} wiped out ${n(e.nation)}`;
      case 'rejected':
        return `Can’t do that: ${e.reason}`;
      case 'buildingCaptured': {
        const what = BUILDING_LABELS[e.building].toLowerCase();
        return e.from === me ? `${n(e.to)} captured your ${what}` : `you captured a ${what} from ${n(e.from)}`;
      }
      case 'buildingDestroyed': {
        const what = BUILDING_LABELS[e.building].toLowerCase();
        return e.owner === me ? `your ${what} was destroyed` : `you destroyed ${n(e.owner)}’s ${what}`;
      }
      case 'unitLost':
        return e.owner === me ? `your ${UNIT_LABELS[e.unit]} was lost` : `you took out ${n(e.owner)}’s ${UNIT_LABELS[e.unit]}`;
      case 'trade':
        return `trade with ${n(e.partner)}: +${formatNumber(e.gold)} gold`;
      case 'radarWarning': {
        const what = e.unit === 'bomber' ? 'Bombers' : e.unit === 'paraPlane' ? 'Paratroopers' : `${UNIT_LABELS[e.unit]}s`;
        return `${what} incoming from ${n(e.from)}!`;
      }
      case 'request': {
        const r = e.request;
        if (r.to !== me) return null;
        if (r.kind === 'alliance') return `${n(r.from)} wants an alliance`;
        if (r.kind === 'peace') return `${n(r.from)} asks for peace`;
        if (r.kind === 'deal') return `${n(r.from)} offers a deal`;
        return `${n(r.from)} asks you to attack ${n(r.target ?? 0)}`;
      }
      case 'requestResolved':
        if (e.from !== me) return null;
        return `${n(e.to)} ${e.accepted ? 'accepted' : 'declined'} your ${REQUEST_LABELS[e.kind]}`;
      case 'relation': {
        const other = e.a === me ? e.b : e.a;
        if (e.relation === 'war') return `you are at war with ${n(other)}`;
        if (e.relation === 'allied') return `you are now allied with ${n(other)}`;
        return `peace with ${n(other)}`;
      }
      case 'betrayal':
        if (e.victim === me) return `${n(e.betrayer)} betrayed you!`;
        return `${n(e.betrayer)} betrayed ${n(e.victim)}`;
      case 'phase':
        return e.phase === 'playing' ? 'The war begins!' : null;
      case 'gameOver':
        return 'The game is over';
      case 'spawned':
        return null;
    }
  })();
  return line === null ? null : line.charAt(0).toUpperCase() + line.slice(1);
}
