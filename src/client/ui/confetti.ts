import { css } from '../render/palette';
import { h } from './dom';

/**
 * Confetti for a win: `count` pieces in the player's `color`, white and gold, falling across the screen for about
 * 2.5 s (the falling is CSS; nothing here blocks clicks).
 */
export function createConfetti(color: number, count = 90): HTMLElement {
  const colors = [css(color), '#ffffff', '#facc15'];
  const el = h('div', { class: 'confetti', attrs: { 'aria-hidden': 'true' } });
  for (let i = 0; i < count; i++) {
    const piece = h('i');
    piece.style.setProperty('--x', `${(Math.random() * 100).toFixed(1)}%`);
    piece.style.setProperty('--delay', `${(Math.random() * 0.6).toFixed(2)}s`);
    piece.style.setProperty('--dur', `${(1.6 + Math.random() * 0.3).toFixed(2)}s`);
    piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 160)}px`);
    piece.style.setProperty('--spin', `${Math.round((Math.random() - 0.5) * 1440)}deg`);
    piece.style.setProperty('--c', colors[i % colors.length]);
    el.append(piece);
  }
  return el;
}
