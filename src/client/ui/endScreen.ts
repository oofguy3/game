import type { ClientState } from '../state';
import { h } from './dom';

/** The victory or defeat overlay, with the player's stats. */
export class EndScreen {
  readonly el = h('div', { class: 'overlay end hidden' });
  private dismissed = false;
  private shownFor = '';

  constructor(private readonly state: ClientState, private readonly landCount: number, private readonly onMenu: () => void) {}

  update(): void {
    const { state } = this;
    const result = state.result;
    const defeated = state.playerDefeated;
    if (!result && !defeated) return;
    const me = state.init.playerId;
    const title = result
      ? result.winners.includes(me) ? (result.reason === 'alliance' ? 'Alliance victory' : 'Victory') : 'Defeat'
      : 'Defeat';
    const key = `${title}|${result ? 'over' : 'running'}`;
    if (key === this.shownFor) return;
    if (!result && this.dismissed) return;
    this.shownFor = key;
    this.dismissed = false;
    const p = state.player;
    const stats = p?.stats;
    const minutes = Math.floor(state.tick / 600);
    const seconds = Math.floor((state.tick % 600) / 10);
    const stat = (label: string, value: string): HTMLElement =>
      h('div', { class: 'end-stat' }, h('span', { class: 'end-stat-label', text: label }), h('span', { class: 'end-stat-value', text: value }));
    const buttons = h('div', { class: 'end-buttons' });
    if (!result) {
      buttons.append(h('button', { text: 'Keep watching', on: { click: () => this.hide(true) } }));
    }
    buttons.append(h('button', { class: 'primary', text: 'Main menu', on: { click: this.onMenu } }));
    this.el.replaceChildren(h('div', { class: 'end-card' },
      h('h1', { class: title === 'Defeat' ? 'defeat' : 'victory', text: title }),
      h('div', { class: 'end-stats' },
        stat('Peak land', `${(((stats?.peakTiles ?? 0) / this.landCount) * 100).toFixed(1)}%`),
        stat('Tiles captured', String(stats?.tilesCaptured ?? 0)),
        stat('Buildings built', String(stats?.buildingsBuilt ?? 0)),
        stat('Time played', `${minutes}:${String(seconds).padStart(2, '0')}`)),
      buttons));
    this.el.classList.remove('hidden');
  }

  private hide(dismiss: boolean): void {
    this.dismissed = dismiss;
    this.el.classList.add('hidden');
  }
}
