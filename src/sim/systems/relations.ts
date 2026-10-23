import { CONFIG } from '../../shared/config';
import type { NationId, Relation } from '../../shared/types';
import type { Game } from '../core/game';

const NEUTRAL = 0;
const ALLIED = 1;
const WAR = 2;
const CODE_OF: Readonly<Record<Relation, number>> = { neutral: NEUTRAL, allied: ALLIED, war: WAR };
const RELATION_OF: readonly Relation[] = ['neutral', 'allied', 'war'];

/** Pairwise diplomatic state for nation ids 0..nationCount-1, stored in flat n*n tables. */
export class Relations {
  private readonly n: number;
  private readonly relation: Uint8Array;
  private readonly embargo: Uint8Array;
  private readonly trustTable: Float32Array;

  constructor(nationCount: number) {
    this.n = nationCount;
    this.relation = new Uint8Array(nationCount * nationCount);
    this.embargo = new Uint8Array(nationCount * nationCount);
    this.trustTable = new Float32Array(nationCount * nationCount).fill(CONFIG.diplomacy.defaultTrust);
  }

  get(a: NationId, b: NationId): Relation {
    return RELATION_OF[this.relation[a * this.n + b]];
  }

  /** Sets the relation of the pair in both directions. */
  set(a: NationId, b: NationId, r: Relation): void {
    this.relation[a * this.n + b] = CODE_OF[r];
    this.relation[b * this.n + a] = CODE_OF[r];
  }

  /** True when either side has an embargo on the other. */
  embargoed(a: NationId, b: NationId): boolean {
    return this.embargo[a * this.n + b] === 1 || this.embargo[b * this.n + a] === 1;
  }

  setEmbargo(from: NationId, to: NationId, on: boolean): void {
    this.embargo[from * this.n + to] = on ? 1 : 0;
  }

  /** How much `from` trusts `to`; directional. */
  trust(from: NationId, to: NationId): number {
    return this.trustTable[from * this.n + to];
  }

  setTrust(from: NationId, to: NationId, v: number): void {
    this.trustTable[from * this.n + to] = v;
  }

  /** Every nation at war with `a`, in id order. */
  warsOf(a: NationId): NationId[] {
    const wars: NationId[] = [];
    const row = a * this.n;
    for (let b = 0; b < this.n; b++) {
      if (this.relation[row + b] === WAR) wars.push(b);
    }
    return wars;
  }
}

/**
 * Puts `a` and `b` at war and emits a `relation` event. Does nothing for the unowned id, for a nation against
 * itself, or for a pair already at war. Throws for allies: callers break the alliance first.
 */
export function declareWar(game: Game, a: NationId, b: NationId): void {
  if (a === 0 || b === 0 || a === b) return;
  const current = game.relations.get(a, b);
  if (current === 'war') return;
  if (current === 'allied') throw new Error(`declareWar: nations ${a} and ${b} are allied`);
  game.relations.set(a, b, 'war');
  game.emit({ type: 'relation', a, b, relation: 'war' });
}

/** Trade needs the pair not at war and no embargo from either side. */
export function canTrade(game: Game, a: NationId, b: NationId): boolean {
  return game.relations.get(a, b) !== 'war' && !game.relations.embargoed(a, b);
}
