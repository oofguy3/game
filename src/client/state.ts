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
  /** Troops in each front, in the same order as `fronts`. */
  frontTroops: number[] = [];
  /** How many tiles became the player's in the latest update. */
  gained = 0;
  /** The player's tiles taken by someone else in the latest update. */
  lost: TileIndex[] = [];
  /** Called with every event of each update (the feed keeps only the player's). */
  onEvents: ((events: GameEvent[]) => void) | null = null;
  /** 1 where the map is fallout. */
  fallout = new Uint8Array();
  /** Tiles that are currently fallout, for drawing. */
  falloutList: number[] = [];
  /** Coastal flags, set by the page so the first beach can be announced. */
  coast: Uint8Array | null = null;
  /** The player owns a coastal tile. */
  reachedSea = false;
  /** Set on the update that first reaches the sea, for the hint banner. */
  announceSea = false;
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
    this.frontTroops = [];
    this.gained = 0;
    this.lost = [];
    this.changed = [];
    this.fallout = new Uint8Array(init.width * init.height);
    this.falloutList = [];
    this.reachedSea = false;
    this.announceSea = false;
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
      // land going back to nobody (a moved spawn) was given up, not taken
      else if (before === me && after !== me && after !== 0) this.lost.push(t);
      if (after === me && this.coast && this.coast[t] === 1 && !this.reachedSea) {
        this.reachedSea = true;
        this.announceSea = true;
      }
      this.owner[t] = after;
      this.changed.push(t);
    }
    for (const t of u.falloutOn ?? []) {
      if (this.fallout[t] === 1) continue;
      this.fallout[t] = 1;
      this.falloutList.push(t);
    }
    const cleared = u.falloutOff;
    if (cleared && cleared.length > 0) {
      for (const t of cleared) this.fallout[t] = 0;
      this.falloutList = this.falloutList.filter((t) => this.fallout[t] === 1);
    }
    this.fronts = u.fronts;
    this.frontTroops = u.frontTroops ?? [];
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
      case 'nuked':
        return e.by === me || e.owner === me;
      case 'nukeIntercepted':
        return e.by === me || e.owner === me;
    }
  }
}
