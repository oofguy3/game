import type { NationId } from '../../shared/types';
import type { NationSnap } from '../../worker/protocol';
import { formatNumber } from '../format';
import { css } from '../render/palette';
import type { ClientState } from '../state';
import { h, setText } from './dom';

const ROWS = 10;

/** The biggest `limit` living nations by land (ties by id), plus the player's row when they're not among them. */
export function leaderboardRows(nations: NationSnap[], playerId: NationId, limit: number): NationSnap[] {
  const rows = nations.filter((n) => n.alive && n.role !== 'tribe').sort((a, b) => b.tiles - a.tiles || a.id - b.id).slice(0, limit);
  const player = nations.find((n) => n.id === playerId);
  if (player && !rows.includes(player)) rows.push(player);
  return rows;
}

/** The top-right table of nations: name, share of the land, troops. */
export class Leaderboard {
  readonly el = h('div', { class: 'panel leaderboard' });
  private readonly body = h('div');
  private readonly landCount: number;

  constructor(private readonly state: ClientState) {
    this.el.append(h('div', { class: 'panel-title', text: 'Leaderboard' }), this.body);
    let land = 0;
    for (const t of state.init.terrain) if (t !== 0) land++;
    this.landCount = Math.max(1, land);
  }

  update(): void {
    const { state } = this;
    const rows = leaderboardRows([...state.nations.values()], state.init.playerId, ROWS);
    while (this.body.children.length > rows.length) this.body.lastElementChild!.remove();
    while (this.body.children.length < rows.length) {
      this.body.append(h('div', { class: 'leaderboard-row' }, h('span', { class: 'swatch' }), h('span', { class: 'name' }),
        h('span', { class: 'land' }), h('span', { class: 'troops' })));
    }
    const info = new Map(state.init.nations.map((n) => [n.id, n]));
    rows.forEach((n, i) => {
      const row = this.body.children[i] as HTMLElement;
      const [swatch, name, land, troops] = [...row.children] as HTMLElement[];
      swatch.style.background = css(info.get(n.id)?.color ?? 0x808080);
      const label = info.get(n.id)?.name ?? '?';
      setText(name, n.traitor ? `${label} (TRAITOR)` : label);
      const held = n.scoreTiles ?? n.tiles;
      const denom = Math.max(1, this.landCount - this.state.falloutList.length);
      setText(land, `${((held / denom) * 100).toFixed(1)}%`);
      setText(troops, formatNumber(n.troops));
      row.classList.toggle('me', n.id === state.init.playerId);
      row.classList.toggle('dead', !n.alive);
    });
  }
}
