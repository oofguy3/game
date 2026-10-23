import { CONFIG } from '../../shared/config';
import { BUILDING_TYPES } from '../../shared/types';
import type { BuildingType } from '../../shared/types';
import { formatNumber } from '../format';
import type { ClientState } from '../state';
import { createBuildIcon } from './buildIcon';
import { h, setText } from './dom';
import { BUILDING_HINTS, BUILDING_LABELS } from './labels';

/** Hotkeys for the build buttons, in BUILDING_TYPES order. */
export const BUILD_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'];
const TICKS_PER_SECOND = 1000 / CONFIG.tickMs;

/** What the player's next building of `type` costs, as the simulation will charge it. */
export function playerBuildingCost(state: ClientState, type: BuildingType): number {
  const me = state.init.playerId;
  const owned = state.buildings.filter((b) => b.owner === me && b.type === type).length;
  return CONFIG.buildings[type].cost * (1 + CONFIG.buildings.costGrowth * owned);
}

/** The bottom bar: troops, gold, the attack-size slider and the build buttons. */
export class Hud {
  readonly el = h('div', { class: 'hud' });
  private readonly troops = h('span', { class: 'stat-value' });
  private readonly gold = h('span', { class: 'stat-value' });
  private readonly income = h('span', { class: 'stat-sub' });
  private readonly slider = h('input', { attrs: { type: 'range', min: '1', max: '100', step: '1', 'aria-label': 'Attack size' } });
  private readonly sliderValue = h('span', { class: 'stat-value' });
  private readonly buttons = new Map<BuildingType, { button: HTMLButtonElement; cost: HTMLElement }>();
  private selected: BuildingType | null = null;

  /** `playerColor` paints the icons on the build buttons. */
  constructor(private readonly state: ClientState, private readonly onBuild: (type: BuildingType) => void, playerColor: number) {
    this.slider.value = '30';
    this.slider.addEventListener('input', () => this.renderRatio());
    const builds = h('div', { class: 'builds' });
    BUILDING_TYPES.forEach((type, i) => {
      const cost = h('span', { class: 'cost' });
      const button = h('button', {
        class: 'build',
        title: `${BUILDING_LABELS[type]} (${BUILD_HOTKEYS[i]}): ${BUILDING_HINTS[type]}`,
        attrs: { 'data-building': type },
        on: { click: () => this.onBuild(type) },
      }, h('span', { class: 'key', text: BUILD_HOTKEYS[i] }), createBuildIcon(type, playerColor),
      h('span', { class: 'label', text: BUILDING_LABELS[type] }), cost);
      this.buttons.set(type, { button, cost });
      builds.append(button);
    });
    this.el.append(
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: 'Troops' }), this.troops),
        h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: 'Gold' }), this.gold, this.income),
        h('div', { class: 'stat attack' }, h('span', { class: 'stat-label', text: 'Attack size' }), this.slider, this.sliderValue)),
      builds,
    );
    this.renderRatio();
  }

  /** The share of troops an attack sends, 0.01–1. */
  get attackRatio(): number {
    return Number(this.slider.value) / 100;
  }

  /** Changes the attack size by `step` percentage points. */
  nudgeRatio(step: number): void {
    this.slider.value = String(Math.min(100, Math.max(1, Number(this.slider.value) + step)));
    this.renderRatio();
  }

  /** Highlights the building being placed, if any. */
  setSelected(type: BuildingType | null): void {
    this.selected = type;
    for (const [t, { button }] of this.buttons) button.classList.toggle('selected', t === type);
  }

  update(): void {
    const p = this.state.player;
    if (!p) return;
    setText(this.troops, `${formatNumber(p.troops)} / ${formatNumber(p.maxTroops)}`);
    setText(this.gold, formatNumber(p.gold));
    setText(this.income, `+${formatNumber(p.income * TICKS_PER_SECOND)}/s`);
    const canBuild = this.state.phase === 'playing' && p.alive;
    for (const [type, { button, cost }] of this.buttons) {
      const price = playerBuildingCost(this.state, type);
      setText(cost, formatNumber(price));
      button.disabled = !canBuild || price > p.gold;
    }
    if (this.selected && this.buttons.get(this.selected)!.button.disabled) this.setSelected(null);
  }

  private renderRatio(): void {
    setText(this.sliderValue, `${this.slider.value}%`);
  }
}
