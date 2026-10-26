import type { Difficulty, GameMode, MapSize } from '../../shared/types';
import type { StartOptions } from '../../worker/protocol';
import { h } from './dom';
import { createLogo } from './logo';
import { createSegmented } from './segmented';

const SIZES = ['small', 'medium', 'large'] as const;
const DIFFICULTIES = ['easy', 'normal', 'hard', 'insane'] as const;
const title = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** The start menu on the title screen. Calls `onPlay` with the chosen options. */
export function createMenu(onPlay: (options: StartOptions) => void, debug: boolean): HTMLElement {
  const field = (label: string, control: HTMLElement, id: string): HTMLElement => {
    control.id = id;
    return h('div', { class: 'field' }, h('label', { text: label, attrs: { for: id } }), control);
  };
  /** A labelled group of choice buttons (the buttons carry the group's name for screen readers). */
  const group = (label: string, control: HTMLElement): HTMLElement =>
    h('div', { class: 'field' }, h('div', { class: 'field-label', text: label }), control);

  const map = createSegmented('Map', [
    { value: 'world', text: 'World' },
    { value: 'random', text: 'Random' },
    { value: 'box', text: 'The Box' },
  ], 'world');
  const mode = createSegmented<GameMode>('Mode', [
    { value: 'ffa', text: 'Free-for-all' },
    { value: 'nations', text: 'Vs Nations' },
  ], 'ffa');
  const size = createSegmented<MapSize>('Size', SIZES.map((s) => ({ value: s, text: title(s) })), 'medium');
  const seed = h('input', { attrs: { type: 'number', min: '1', step: '1' } });
  seed.value = String(1 + Math.floor(Math.random() * 999_999));
  const bots = h('input', { attrs: { type: 'number', min: '4', max: '40', step: '1' } });
  bots.value = '12';
  const botsRange = h('input', { attrs: { type: 'range', min: '4', max: '40', step: '1', 'aria-hidden': 'true', tabindex: '-1' } });
  botsRange.value = '12';
  botsRange.addEventListener('input', () => { bots.value = botsRange.value; });
  bots.addEventListener('input', () => { botsRange.value = bots.value; });
  const difficulty = createSegmented<Difficulty>('Difficulty', DIFFICULTIES.map((d) => ({ value: d, text: title(d) })), 'normal');
  const name = h('input', { attrs: { type: 'text', maxlength: '20' } });
  name.value = 'You';
  const randomOnly = h('div', { class: 'random-only' }, group('Size', size.el), field('Seed', seed, 'menu-seed'));
  const sync = (): void => {
    randomOnly.classList.toggle('hidden', map.value === 'world');
  };
  map.onChange = sync;
  sync();

  const play = h('button', { class: 'primary play', text: 'Play', attrs: { type: 'submit' } });
  const form = h('form', { class: 'menu-card' },
    createLogo('large'),
    h('p', { class: 'tagline', text: 'Spread across the map, build up, and take over the world.' }),
    group('Map', map.el),
    randomOnly,
    group('Mode', mode.el),
    h('div', { class: 'field' }, h('label', { text: 'Bots', attrs: { for: 'menu-bots' } }), h('div', { class: 'bots' }, botsRange, bots)),
    group('Difficulty', difficulty.el),
    field('Your name', name, 'menu-name'),
    play);
  bots.id = 'menu-bots';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const count = Math.min(40, Math.max(4, Math.round(Number(bots.value) || 12)));
    const seedValue = Math.max(1, Math.round(Number(seed.value) || 1));
    const choice = map.value === 'world'
      ? { kind: 'world' as const }
      : { kind: map.value === 'box' ? 'box' as const : 'random' as const, size: size.value, seed: seedValue };
    onPlay({
      map: choice,
      bots: count,
      difficulty: difficulty.value,
      seed: seedValue,
      playerName: name.value.trim() || 'You',
      debug,
      mode: mode.value,
    });
  });
  return h('div', { class: 'overlay menu' }, form);
}
