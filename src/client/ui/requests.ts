import { CONFIG } from '../../shared/config';
import type { Command, DiplomacyRequest, NationId } from '../../shared/types';
import { formatNumber } from '../format';
import type { ClientState } from '../state';
import { h, setText } from './dom';

const TICKS_PER_SECOND = 1000 / CONFIG.tickMs;

/** What a request to the player asks, in a line: "Varlonia offers 1.5k gold for 300 troops". */
export function describeRequest(req: DiplomacyRequest, names: Map<NationId, string>): string {
  const who = names.get(req.from) ?? 'Someone';
  switch (req.kind) {
    case 'alliance':
      return `${who} offers an alliance`;
    case 'peace':
      return `${who} asks for peace`;
    case 'jointAttack':
      return `${who} asks you to attack ${names.get(req.target ?? 0) ?? 'someone'}`;
    case 'deal': {
      const d = req.deal ?? { giveGold: 0, giveTroops: 0, getGold: 0, getTroops: 0 };
      const offered = amounts(d.giveGold, d.giveTroops) || 'nothing';
      const asked = amounts(d.getGold, d.getTroops);
      return asked ? `${who} offers ${offered} for ${asked}` : `${who} sends you ${offered}`;
    }
  }
}

function amounts(gold: number, troops: number): string {
  const parts: string[] = [];
  if (gold > 0) parts.push(`${formatNumber(gold)} gold`);
  if (troops > 0) parts.push(`${formatNumber(troops)} troops`);
  return parts.join(' and ');
}

/** Whether `req` no longer means anything: an alliance offer from an ally, or peace from a nation not at war with us. */
export function isStale(state: ClientState, req: DiplomacyRequest): boolean {
  const relation = state.nations.get(req.from)?.relationToPlayer;
  return (req.kind === 'alliance' && relation === 'allied') || (req.kind === 'peace' && relation !== 'war');
}

/** The requests worth a pop-up: none once the game is over (nothing can be answered), and never stale ones. */
export function openRequests(state: ClientState): DiplomacyRequest[] {
  return state.phase === 'ended' ? [] : state.requests.filter((r) => !isStale(state, r));
}

/** Whole seconds until `req` expires, at tick `tick`. */
export function secondsLeft(req: DiplomacyRequest, tick: number): number {
  return Math.max(0, Math.ceil((req.expiresAt - tick) / TICKS_PER_SECOND));
}

/**
 * Pop-ups (top right) for the requests waiting on the player, each with Accept, Decline and a countdown; offers the
 * relation already settled are left out.
 */
export class RequestPopups {
  readonly el = h('div', { class: 'requests' });
  private readonly cards = new Map<number, { card: HTMLElement; timer: HTMLElement }>();
  /** Requests answered here whose answer the simulation hasn't confirmed yet. */
  private readonly answered = new Set<number>();

  constructor(
    private readonly state: ClientState,
    private readonly names: Map<NationId, string>,
    private readonly send: (cmd: Command) => void,
  ) {}

  update(): void {
    const requests = openRequests(this.state);
    const open = new Set(requests.map((r) => r.id));
    for (const id of this.answered) if (!open.has(id)) this.answered.delete(id);
    for (const [id, { card }] of this.cards) {
      if (open.has(id) && !this.answered.has(id)) continue;
      card.remove();
      this.cards.delete(id);
    }
    for (const r of requests) {
      if (this.answered.has(r.id)) continue;
      let entry = this.cards.get(r.id);
      if (!entry) {
        const timer = h('span', { class: 'request-timer' });
        const card = h('div', { class: 'request panel' },
          h('div', { class: 'request-text', text: describeRequest(r, this.names) }),
          h('div', { class: 'request-buttons' },
            h('button', { class: 'primary', text: 'Accept', on: { click: () => this.answer(r.id, true) } }),
            h('button', { text: 'Decline', on: { click: () => this.answer(r.id, false) } }),
            timer));
        entry = { card, timer };
        this.cards.set(r.id, entry);
        this.el.append(card);
      }
      setText(entry.timer, `${secondsLeft(r, this.state.tick)}s`);
    }
  }

  private answer(requestId: number, accept: boolean): void {
    this.answered.add(requestId);
    this.send({ type: 'respond', nation: this.state.init.playerId, requestId, accept });
    this.update();
  }
}
