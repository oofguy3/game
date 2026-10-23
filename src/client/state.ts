import type { DiplomacyRequest, GameEvent, GameResult, NationId, Phase, TileIndex } from '../shared/types';
import type { BuildingSnap, GameUpdate, InitPayload, NationSnap, UnitSnap } from '../worker/protocol';

const FEED_LENGTH = 50;

/** The page's copy of the game, kept current from the worker's updates. */
export class ClientState {
  init!: InitPayload;
  owner!: Uint16Array;
  tick = 0;
  phase: Phase = 'spawn';
  nations = new Map<NationId, NationSnap>();
  buildings: BuildingSnap[] = [];
  units: UnitSnap[] = [];
  /** The last `FEED_LENGTH` events that concern the player, oldest first. */
  feed: GameEvent[] = [];
  requests: DiplomacyRequest[] = [];
  result: GameResult | null = null;
  /** Running attacks between two nations as [attacker, target], from the latest update. */
  fronts: [NationId, NationId][] = [];
  /** How many tiles became the player's in the latest update. */
  gained = 0;
  /** The player's tiles taken by someone else in the latest update. */
  lost: TileIndex[] = [];
  /** Called with every event of each update (the feed keeps only the player's). */
  onEvents: ((events: GameEvent[]) => void) | null = null;
  private changed: number[] = [];

  get player(): NationSnap | undefined {
    return this.nations.get(this.init?.playerId);
  }

  /** Whether the player has lost all their land. */
  get playerDefeated(): boolean {
    const p = this.player;
    return p !== undefined && !p.alive;
  }

  applyInit(init: InitPayload): void {
    this.init = init;
    this.owner = new Uint16Array(init.width * init.height);
    this.tick = 0;
    this.phase = 'spawn';
    this.nations = new Map();
    this.buildings = [];
    this.units = [];
    this.feed = [];
    this.requests = [];
    this.result = null;
    this.fronts = [];
    this.gained = 0;
    this.lost = [];
    this.changed = [];
  }

  applyUpdate(u: GameUpdate): void {
    const me = this.init.playerId;
    this.gained = 0;
    this.lost = [];
    for (let i = 0; i < u.changedTiles.length; i++) {
      const t = u.changedTiles[i];
      const before = this.owner[t];
      const after = u.changedOwners[i];
      if (after === me && before !== me) this.gained++;
      else if (before === me && after !== me) this.lost.push(t);
      this.owner[t] = after;
      this.changed.push(t);
    }
    this.fronts = u.fronts;
    this.tick = u.tick;
    this.phase = u.phase;
    this.nations = new Map(u.nations.map((n) => [n.id, n]));
    if (u.buildings !== null) this.buildings = u.buildings;
    this.units = u.units;
    this.requests = u.requests;
    this.result = u.result;
    this.onEvents?.(u.events);
    for (const e of u.events) if (this.concernsPlayer(e)) this.feed.push(e);
    if (this.feed.length > FEED_LENGTH) this.feed.splice(0, this.feed.length - FEED_LENGTH);
  }

  /** Tiles whose owner changed since the last call. */
  drainChangedTiles(): number[] {
    const out = this.changed;
    this.changed = [];
    return out;
  }

  /** Whether `e` is worth telling the player about: it involves them, or it's big news for everyone. */
  private concernsPlayer(e: GameEvent): boolean {
    const me = this.init.playerId;
    switch (e.type) {
      case 'phase':
      case 'gameOver':
      case 'eliminated':
      case 'betrayal':
        return true;
      case 'rejected':
      case 'spawned':
      case 'buildingDone':
      case 'landed':
      case 'trade':
      case 'radarWarning':
        return e.nation === me;
      case 'attackStarted':
        return e.attacker === me || e.target === me;
      case 'buildingCaptured':
        return e.from === me || e.to === me;
      case 'buildingDestroyed':
      case 'bombed':
        return e.owner === me || e.by === me;
      case 'unitLost':
        return e.owner === me || e.by === me;
      case 'request':
        return e.request.to === me || e.request.from === me;
      case 'requestResolved':
        return e.to === me || e.from === me;
      case 'relation':
        return e.a === me || e.b === me;
    }
  }
}
