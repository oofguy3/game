import { CONFIG } from '../../shared/config';
import type { NationId } from '../../shared/types';
import { formatNumber } from '../format';
import type { ClientState } from '../state';
import { h, setText } from './dom';

export interface FrontLine {
  text: string;
  incoming: boolean;
  outgoing: boolean;
}

/** One row of the attacks panel: who is fighting whom, and whether it involves the player. */
export function frontLines(
  fronts: readonly (readonly [NationId, NationId])[],
  troops: readonly number[] | undefined,
  names: Map<NationId, string>,
  me: NationId,
): FrontLine[] {
  return fronts.map(([attacker, target], i) => {
    const who = (id: NationId): string => (id === me ? 'You' : names.get(id) ?? 'Someone');
    const count = troops?.[i];
    const size = count !== undefined && count > 0 ? `  ${formatNumber(count)}` : '';
    return {
      text: `${who(attacker)} → ${who(target)}${size}`,
      incoming: target === me,
      outgoing: attacker === me,
    };
  });
}

/** Lists every fight on the map and shouts when one of them is aimed at the player. */
export class AttacksPanel {
  readonly el = h('div', { class: 'panel attacks hidden' });
  private readonly title = h('div', { class: 'panel-title', text: 'Attacks' });
  private readonly list = h('div');

  constructor(private readonly state: ClientState, private readonly names: Map<NationId, string>) {
    this.el.append(this.title, this.list);
  }

  update(): void {
    const me = this.state.init.playerId;
    const lines = frontLines(this.state.fronts, this.state.frontTroops, this.names, me);
    const incoming = lines.some((l) => l.incoming);
    const shieldTicks = this.state.init.spawnEndsAt + CONFIG.spawn.protectTicks - this.state.tick;
    const shielded = (this.state.player?.shielded ?? false) && shieldTicks > 0 && this.state.phase === 'playing';
    this.el.classList.toggle('hidden', this.state.phase !== 'playing' || (lines.length === 0 && !shielded));
    setText(this.title, incoming ? 'YOU ARE UNDER ATTACK' : shielded ? `Spawn protection ${Math.ceil(shieldTicks / 10)}s` : 'Attacks');
    this.title.classList.toggle('hit', incoming);
    const rows = lines.map((line) => h('div', {
      class: `attack-row${line.incoming ? ' incoming' : ''}${line.outgoing ? ' outgoing' : ''}`,
      text: line.text,
    }));
    if (shielded && lines.length === 0) rows.push(h('div', { class: 'attack-row', text: 'Attacking a nation ends it.' }));
    this.list.replaceChildren(...rows);
  }
}
