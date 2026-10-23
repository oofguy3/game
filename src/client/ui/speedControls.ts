import type { Speed } from '../../worker/scheduler';
import { h } from './dom';

const SPEEDS: { speed: Speed; label: string; title: string }[] = [
  { speed: 0, label: '⏸', title: 'Pause (Space)' },
  { speed: 1, label: '1×', title: 'Normal speed' },
  { speed: 2, label: '2×', title: 'Double speed' },
  { speed: 4, label: '4×', title: 'Quadruple speed' },
];

/** Pause and speed buttons. Space toggles between paused and the last speed. */
export class SpeedControls {
  readonly el = h('div', { class: 'panel speed' });
  private speed: Speed = 1;
  private lastRunning: Speed = 1;
  private readonly buttons: HTMLButtonElement[];

  constructor(private readonly onSpeed: (speed: Speed) => void) {
    this.buttons = SPEEDS.map(({ speed, label, title }) =>
      h('button', { text: label, title, attrs: { 'aria-label': title }, on: { click: () => this.set(speed) } }));
    this.el.append(...this.buttons);
    this.render();
  }

  set(speed: Speed): void {
    this.speed = speed;
    if (speed !== 0) this.lastRunning = speed;
    this.onSpeed(speed);
    this.render();
  }

  togglePause(): void {
    this.set(this.speed === 0 ? this.lastRunning : 0);
  }

  private render(): void {
    SPEEDS.forEach(({ speed }, i) => this.buttons[i].classList.toggle('active', speed === this.speed));
  }
}
