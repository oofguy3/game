import type { GameEvent, NationId } from '../../shared/types';
import type { BuildingSnap, UnitSnap } from '../../worker/protocol';
import type { SoundName } from './catalog';

/** What one update brought: its events, how many tiles the player gained, every unit, and the buildings if changed. */
export interface UpdateFacts {
  events: GameEvent[];
  gained: number;
  units: UnitSnap[];
  buildings: BuildingSnap[] | null;
}

/** The order sounds of one update are listed in. */
const ORDER: SoundName[] = ['click', 'place', 'built', 'send', 'thud', 'horn', 'jet', 'boom', 'landing', 'refused', 'warning',
  'radar', 'offer', 'accepted', 'declined', 'betrayal', 'lost', 'warStart', 'knockout', 'victory', 'defeat'];

/**
 * Decides which sounds each update makes for player `me`: only what involves them. New units and buildings are found
 * by remembering every id seen; victory and defeat sound at most once per match.
 */
export class SoundDirector {
  private readonly units = new Set<number>();
  private readonly buildings = new Set<number>();
  private ended = false;

  constructor(private readonly me: NationId) {}

  sounds(facts: UpdateFacts): SoundName[] {
    const { me } = this;
    const out = new Set<SoundName>();
    for (const e of facts.events) {
      switch (e.type) {
        case 'buildingDone':
          if (e.nation === me) out.add('built');
          break;
        case 'attackStarted':
          if (e.attacker === me) out.add('send');
          else if (e.target === me) out.add('warning');
          break;
        case 'bombed':
          if (e.by === me || e.owner === me) out.add('boom');
          break;
        case 'nuked':
          if (e.by === me || e.owner === me) out.add('boom');
          break;
        case 'nukeIntercepted':
          if (e.by === me || e.owner === me) out.add('warning');
          break;
        case 'landed':
          if (e.nation === me) out.add('landing');
          break;
        case 'rejected':
          if (e.nation === me) out.add('refused');
          break;
        case 'radarWarning':
          if (e.nation === me) out.add('radar');
          break;
        case 'request':
          if (e.request.to === me) out.add('offer');
          break;
        case 'requestResolved':
          if (e.from === me) out.add(e.accepted ? 'accepted' : 'declined');
          break;
        case 'betrayal':
          if (e.victim === me) out.add('betrayal');
          break;
        case 'buildingCaptured':
          if (e.from === me) out.add('lost');
          break;
        case 'buildingDestroyed':
          if (e.owner === me) out.add('lost');
          break;
        case 'phase':
          if (e.phase === 'playing') out.add('warStart');
          break;
        case 'eliminated':
          if (e.nation === me) this.end(out, 'defeat');
          else if (e.by === me) out.add('knockout');
          break;
        case 'gameOver':
          this.end(out, e.result.winners.includes(me) ? 'victory' : 'defeat');
          break;
      }
    }
    if (facts.gained > 0) out.add('thud');
    for (const u of facts.units) {
      if (this.units.has(u.id)) continue;
      this.units.add(u.id);
      if (u.owner !== me) continue;
      if (u.type === 'troopBoat' || u.type === 'warship') out.add('horn');
      else if (u.type === 'bomber' || u.type === 'paraPlane' || u.type === 'fighter') out.add('jet');
    }
    for (const b of facts.buildings ?? []) {
      if (this.buildings.has(b.id)) continue;
      this.buildings.add(b.id);
      if (b.owner === me) out.add('place');
    }
    return ORDER.filter((s) => out.has(s));
  }

  private end(out: Set<SoundName>, sound: 'victory' | 'defeat'): void {
    if (this.ended) return;
    this.ended = true;
    out.add(sound);
  }
}
