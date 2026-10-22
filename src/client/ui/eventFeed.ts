import type { NationId } from '../../shared/types';
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
    const lines: string[] = [];
    for (let i = this.state.feed.length - 1; i >= 0 && lines.length < LINES; i--) {
      const text = describeEvent(this.state.feed[i], this.names, this.state.init.playerId);
      if (text) lines.unshift(text);
    }
    const key = lines.join('\n');
    if (key === this.shown) return;
    this.shown = key;
    this.el.replaceChildren(...lines.map((text) => h('div', { class: 'feed-line', text })));
  }
}
