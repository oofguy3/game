import type { ClientState } from '../state';
import { createConfetti } from './confetti';
import { countUp } from './countUp';
import { h, setText } from './dom';

/** How long the stats take to count up. */
const COUNT_MS = 800;

interface Stat {
  label: string;
  value: number;
  format: (v: number) => string;
}

/**
 * The victory or defeat overlay, with the player's stats counting up. Victory pops in with a shining title and
 * confetti; defeat drops in and greys the map (through `setGrey`) until the player chooses to keep watching.
 */
export class EndScreen {
  readonly el = h('div', { class: 'overlay end hidden' });
  private dismissed = false;
  private shownFor = '';
  private counting = 0;

  constructor(
    private readonly state: ClientState,
    private readonly landCount: number,
    private readonly onMenu: () => void,
    private readonly setGrey: (on: boolean) => void = () => {},
    private readonly playerColor = 0x3b82f6,
  ) {}

  update(): void {
    const { state } = this;
    const result = state.result;
    const defeated = state.playerDefeated;
    if (!result && !defeated) return;
    const me = state.init.playerId;
    const won = result !== null && result.winners.includes(me);
    const title = won && result
      ? (result.reason === 'alliance' ? 'Alliance victory' : 'Victory')
      : 'YOUR NATION HAS FALLEN';
    const key = `${title}|${result ? 'over' : 'running'}`;
    if (key === this.shownFor) return;
    if (!result && this.dismissed) return;
    this.shownFor = key;
    this.dismissed = false;
    const victory = won;
    const stats = state.player?.stats;
    const seconds = Math.floor(state.tick / 10);
    const list: Stat[] = [
      // peak land in tenths of a percent, so it can count up as a whole number
      { label: 'Peak land', value: Math.round(((stats?.peakTiles ?? 0) / this.landCount) * 1000), format: (v) => `${(v / 10).toFixed(1)}%` },
      { label: 'Tiles captured', value: stats?.tilesCaptured ?? 0, format: String },
      { label: 'Buildings built', value: stats?.buildingsBuilt ?? 0, format: String },
      { label: 'Time played', value: seconds, format: (v) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}` },
    ];
    const values = list.map(() => h('span', { class: 'end-stat-value' }));
    const buttons = h('div', { class: 'end-buttons' });
    if (!result) {
      buttons.append(h('button', { text: 'Keep watching', on: { click: () => this.hide(true) } }));
    }
    buttons.append(h('button', { class: 'primary', text: 'Main menu', on: { click: this.onMenu } }));
    const card = h('div', { class: `end-card ${victory ? 'pop' : 'drop'}` },
      h('h1', { class: victory ? 'victory shine' : 'defeat', text: title }),
      h('div', { class: 'end-stats' }, ...list.map((s, i) =>
        h('div', { class: 'end-stat' }, h('span', { class: 'end-stat-label', text: s.label }), values[i]))),
      buttons);
    this.el.replaceChildren(card, ...(victory ? [createConfetti(this.playerColor)] : []));
    this.el.classList.remove('hidden');
    this.setGrey(!victory);
    this.countStats(list, values);
  }

  private countStats(list: Stat[], values: HTMLElement[]): void {
    cancelAnimationFrame(this.counting);
    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      list.forEach((s, i) => setText(values[i], s.format(countUp(s.value, elapsed, COUNT_MS))));
      if (elapsed < COUNT_MS) this.counting = requestAnimationFrame(tick);
    };
    tick(start);
  }

  private hide(dismiss: boolean): void {
    this.dismissed = dismiss;
    this.el.classList.add('hidden');
    this.setGrey(false);
  }
}
