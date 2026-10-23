import type { Mixer } from '../audio/mixer';
import { h } from './dom';

/** The speaker button (mute and unmute) and the volume slider, next to the pause button. */
export class SoundControls {
  readonly el = h('div', { class: 'panel sound' });
  private readonly button = h('button', { on: { click: () => this.toggle() } });
  private readonly slider = h('input', { attrs: { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Volume' } });

  constructor(private readonly mixer: Mixer) {
    this.slider.value = String(Math.round(mixer.settings.volume * 100));
    this.slider.addEventListener('input', () => this.mixer.setVolume(Number(this.slider.value) / 100));
    this.el.append(this.button, this.slider);
    this.render();
  }

  private toggle(): void {
    this.mixer.setMuted(!this.mixer.settings.muted);
    this.render();
  }

  private render(): void {
    const muted = this.mixer.settings.muted;
    const label = muted ? 'Unmute sound' : 'Mute sound';
    this.button.textContent = muted ? '🔇' : '🔊';
    this.button.title = label;
    this.button.setAttribute('aria-label', label);
    this.button.classList.toggle('active', muted);
  }
}
