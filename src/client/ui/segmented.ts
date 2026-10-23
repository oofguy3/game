import { h } from './dom';

export interface Segmented<T extends string> {
  readonly el: HTMLElement;
  readonly value: T;
  onChange: ((value: T) => void) | null;
}

/**
 * A row of buttons of which exactly one is chosen: a radio group named `label`, with arrow keys moving the choice.
 */
export function createSegmented<T extends string>(label: string, options: readonly { value: T; text: string }[], initial: T): Segmented<T> {
  const el = h('div', { class: 'segmented', attrs: { role: 'radiogroup', 'aria-label': label } });
  let value = initial;
  const result: Segmented<T> = {
    el,
    get value() {
      return value;
    },
    onChange: null,
  };
  const buttons = options.map((o) => h('button', {
    text: o.text,
    attrs: { type: 'button', role: 'radio', 'data-value': o.value },
    on: { click: () => select(o.value, false) },
  }));
  function select(next: T, focus: boolean): void {
    const changed = next !== value;
    value = next;
    buttons.forEach((b, i) => {
      const on = options[i].value === next;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('on', on);
      if (on && focus) b.focus();
    });
    if (changed) result.onChange?.(next);
  }
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    select(options[j].value, true);
  });
  el.append(...buttons);
  select(initial, false);
  return result;
}
