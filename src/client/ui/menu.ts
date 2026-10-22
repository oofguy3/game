import { GAME_NAME } from '../../shared/constants';
import type { Difficulty, MapSize } from '../../shared/types';
import type { StartOptions } from '../../worker/protocol';
import { h } from './dom';

/** The start menu. Calls `onPlay` with the chosen options. */
export function createMenu(onPlay: (options: StartOptions) => void, debug: boolean): HTMLElement {
  const field = (label: string, control: HTMLElement, id: string): HTMLElement => {
    control.id = id;
    return h('div', { class: 'field' }, h('label', { text: label, attrs: { for: id } }), control);
  };
  const map = h('select', {}, h('option', { text: 'World', attrs: { value: 'world' } }), h('option', { text: 'Random', attrs: { value: 'random' } }));
  const size = h('select', {}, ...(['small', 'medium', 'large'] as const).map((s) =>
    h('option', { text: s[0].toUpperCase() + s.slice(1), attrs: { value: s } })));
  size.value = 'medium';
  const seed = h('input', { attrs: { type: 'number', min: '1', step: '1' } });
  seed.value = String(1 + Math.floor(Math.random() * 999_999));
  const bots = h('input', { attrs: { type: 'number', min: '4', max: '40', step: '1' } });
  bots.value = '12';
  const botsRange = h('input', { attrs: { type: 'range', min: '4', max: '40', step: '1', 'aria-hidden': 'true', tabindex: '-1' } });
  botsRange.value = '12';
  botsRange.addEventListener('input', () => { bots.value = botsRange.value; });
  bots.addEventListener('input', () => { botsRange.value = bots.value; });
  const difficulty = h('select', {}, ...(['easy', 'normal', 'hard', 'insane'] as const).map((d) =>
    h('option', { text: d[0].toUpperCase() + d.slice(1), attrs: { value: d } })));
  difficulty.value = 'normal';
  const name = h('input', { attrs: { type: 'text', maxlength: '20' } });
  name.value = 'You';
  const randomOnly = h('div', { class: 'random-only' }, field('Size', size, 'menu-size'), field('Seed', seed, 'menu-seed'));
  const sync = (): void => {
    randomOnly.classList.toggle('hidden', map.value !== 'random');
  };
  map.addEventListener('change', sync);
  sync();

  const play = h('button', { class: 'primary play', text: 'Play' });
  const form = h('form', { class: 'menu-card' },
    h('h1', { text: GAME_NAME }),
    h('p', { class: 'tagline', text: 'Spread across the map, build up, and take over the world.' }),
    field('Map', map, 'menu-map'),
    randomOnly,
    h('div', { class: 'field' }, h('label', { text: 'Bots', attrs: { for: 'menu-bots' } }), h('div', { class: 'bots' }, botsRange, bots)),
    field('Difficulty', difficulty, 'menu-difficulty'),
    field('Your name', name, 'menu-name'),
    play);
  bots.id = 'menu-bots';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const count = Math.min(40, Math.max(4, Math.round(Number(bots.value) || 12)));
    const seedValue = Math.max(1, Math.round(Number(seed.value) || 1));
    onPlay({
      map: map.value === 'world' ? { kind: 'world' } : { kind: 'random', size: size.value as MapSize, seed: seedValue },
      bots: count,
      difficulty: difficulty.value as Difficulty,
      seed: seedValue,
      playerName: name.value.trim() || 'You',
      debug,
    });
  });
  return h('div', { class: 'overlay menu' }, form);
}
