import type { AidRefusal, DiplomacyRequest, GameEvent, NationId } from '../../shared/types';
import { formatNumber } from '../format';
import { BUILDING_LABELS, UNIT_LABELS } from './labels';

const REQUEST_LABELS: Record<DiplomacyRequest['kind'], string> = {
  alliance: 'alliance offer',
  peace: 'peace offer',
  deal: 'deal',
  jointAttack: 'call to attack',
  aid: 'ask for help',
};

/** Why a teammate said no to the player's ask for help, after "says no: ". */
const AID_REFUSALS: Record<AidRefusal, string> = {
  busy: 'busy with its own war',
  cantSpare: 'can’t spare any',
  notNow: 'not now',
};

/** A one-line description of `e` for the player `me`, or null when it isn't worth a line in the feed. */
export function describeEvent(e: GameEvent, names: Map<NationId, string>, me: NationId): string | null {
  const n = (id: NationId): string => (id === me ? 'you' : names.get(id) ?? 'Someone');
  const line = ((): string | null => {
    switch (e.type) {
      case 'attackStarted':
        if (e.target === 0) return null;
        if (e.support?.ally === me) {
          return e.support.kind === 'join'
            ? `${n(e.attacker)} joins your attack on ${n(e.target)}`
            : `${n(e.attacker)} strikes back at ${n(e.target)} for you`;
        }
        if (e.attacker === me) return `you attacked ${n(e.target)}`;
        return e.target === me ? `${n(e.attacker)} attacked you` : null;
      case 'buildingDone':
        return `${BUILDING_LABELS[e.building]} complete`;
      case 'landed':
        return 'your troops landed';
      case 'eliminated':
        if (e.by === 0) return e.nation === me ? 'you found nowhere to start and are out' : `${n(e.nation)} found nowhere to start and is out`;
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
      case 'bombed':
        return e.owner === me ? `${n(e.by)} bombed you` : `your bombers hit ${n(e.owner)}`;
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
        if (r.kind === 'aid') return `${n(r.from)} asks you for ${r.resource ?? 'help'}`;
        return `${n(r.from)} asks you to attack ${n(r.target ?? 0)}`;
      }
      case 'requestResolved': {
        if (e.from !== me) return null;
        if (e.kind === 'aid') {
          // a yes shows as the aidSent line
          if (e.accepted) return null;
          const why = e.reason && AID_REFUSALS[e.reason];
          if (why) return `${n(e.to)} says no: ${why}`;
        }
        return `${n(e.to)} ${e.accepted ? 'accepted' : 'declined'} your ${REQUEST_LABELS[e.kind]}`;
      }
      case 'aidSent': {
        if (e.from !== me && e.to !== me) return null;
        const parts: string[] = [];
        if (e.troops > 0) parts.push(`${formatNumber(e.troops)} troops`);
        if (e.gold > 0) parts.push(`${formatNumber(e.gold)} gold`);
        return `${n(e.from)} sent ${n(e.to)} ${parts.join(' and ')}`;
      }
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
