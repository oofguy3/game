import type { GameEvent, NationId } from '../../shared/types';
import type { ClientState } from '../state';
import { h } from './dom';
import { describeEvent } from './eventText';

const LINES = 6;

/**
 * The last few things that happened to the player, in plain English. Each line keeps its element while it is shown,
 * so only new lines slide in.
 */
export class EventFeed {
  readonly el = h('div', { class: 'feed' });
  /** The lines on show, oldest first, with the event each one tells. */
  private lines: { event: GameEvent; el: HTMLElement }[] = [];

  constructor(private readonly state: ClientState, private readonly names: Map<NationId, string>) {}

  update(): void {
    const me = this.state.init.playerId;
    const shown = new Map(this.lines.map((l) => [l.event, l.el]));
    const lines: { event: GameEvent; el: HTMLElement }[] = [];
    for (let i = this.state.feed.length - 1; i >= 0 && lines.length < LINES; i--) {
      const e = this.state.feed[i];
      const text = describeEvent(e, this.names, me);
      if (!text) continue;
      const el = shown.get(e) ?? h('div', { class: isAlarm(e, me) ? 'feed-line alarm' : 'feed-line', text });
      lines.unshift({ event: e, el });
    }
    const keep = new Set(lines.map((l) => l.el));
    for (const l of this.lines) if (!keep.has(l.el)) l.el.remove();
    // new events are always the latest, so new lines go at the end and the others stay where they are
    for (const l of lines) if (l.el.parentNode !== this.el) this.el.append(l.el);
    this.lines = lines;
  }
}

/** Whether `e` is a threat to player `me`, shown in red: planes on radar, attacks and bombs on them, betrayal. */
export function isAlarm(e: GameEvent, me: NationId): boolean {
  switch (e.type) {
    case 'radarWarning':
      return true;
    case 'attackStarted':
      return e.target === me;
    case 'bombed':
      return e.owner === me;
    case 'betrayal':
      return e.victim === me;
    default:
      return false;
  }
}
