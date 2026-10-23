import { h } from './dom';

/** The game's one speed control: pause and resume (Space does the same). */
export class PauseButton {
  readonly el = h('div', { class: 'panel pause' });
  private paused = false;
  private readonly button = h('button', { on: { click: () => this.toggle() } });

  constructor(private readonly onChange: (paused: boolean) => void) {
    this.el.append(this.button);
    this.render();
  }

  toggle(): void {
    this.paused = !this.paused;
    this.onChange(this.paused);
    this.render();
  }

  private render(): void {
    const label = this.paused ? 'Resume (Space)' : 'Pause (Space)';
    this.button.textContent = this.paused ? '▶' : '⏸';
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
    this.button.classList.toggle('active', this.paused);
  }
}
