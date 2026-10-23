import type { GameEvent, NationId } from '../../shared/types';
import type { ClientState } from '../state';
import { h } from './dom';
import { describeEvent } from './eventText';

const LINES = 6;

/** The last few things that happened to the player, in plain English. */
export class EventFeed {
  readonly el = h('div', { class: 'feed' });
  private shown = '';

  constructor(private readonly state: ClientState, private readonly names: Map<NationId, string>) {}

  update(): void {
    const me = this.state.init.playerId;
    const lines: { text: string; alarm: boolean }[] = [];
    for (let i = this.state.feed.length - 1; i >= 0 && lines.length < LINES; i--) {
      const e = this.state.feed[i];
      const text = describeEvent(e, this.names, me);
      if (text) lines.unshift({ text, alarm: isAlarm(e, me) });
    }
    const key = lines.map((l) => `${l.alarm ? '!' : ''}${l.text}`).join('\n');
    if (key === this.shown) return;
    this.shown = key;
    this.el.replaceChildren(...lines.map(({ text, alarm }) => h('div', { class: alarm ? 'feed-line alarm' : 'feed-line', text })));
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
