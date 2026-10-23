import type { Command, Deal, NationId, Relation } from '../../shared/types';
import { formatNumber } from '../format';
import { css } from '../render/palette';
import type { ClientState } from '../state';
import { h, setText } from './dom';

const RELATION_LABELS: Record<Relation, string> = { neutral: 'Neutral', allied: 'Allied', war: 'At war' };
const DEAL_FIELDS: { key: keyof Deal; label: string }[] = [
  { key: 'giveGold', label: 'Give gold' },
  { key: 'giveTroops', label: 'Give troops' },
  { key: 'getGold', label: 'Get gold' },
  { key: 'getTroops', label: 'Get troops' },
];

/** The buttons the panel shows for a nation the player has `relation` with. */
export function relationActions(relation: Relation, embargoed: boolean): string[] {
  const out = [relation === 'allied' ? 'Break alliance' : 'Propose alliance'];
  if (relation === 'war') out.push('Propose peace');
  out.push(embargoed ? 'Embargo off' : 'Embargo on', 'Gift');
  return out;
}

/** The deal the form describes, each amount a whole number ≥ 0; a gift asks for nothing back. */
export function dealFromForm(values: Record<keyof Deal, string>, gift = false): Deal {
  const amount = (s: string): number => {
    const n = Math.floor(Number(s));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    giveGold: amount(values.giveGold),
    giveTroops: amount(values.giveTroops),
    getGold: gift ? 0 : amount(values.getGold),
    getTroops: gift ? 0 : amount(values.getTroops),
  };
}

/**
 * Living nations, besides the player and `ally`, the player could ask `ally` to attack — allied neither with the player
 * nor with `ally` — in id order.
 */
export function jointTargets(state: ClientState, ally: NationId): NationId[] {
  const theirs = state.nations.get(ally)?.allies ?? [];
  const out: NationId[] = [];
  for (const n of state.nations.values()) {
    if (n.id === state.init.playerId || n.id === ally || !n.alive || n.relationToPlayer === 'allied') continue;
    if (theirs.includes(n.id)) continue;
    out.push(n.id);
  }
  return out.sort((a, b) => a - b);
}

/** The panel for dealing with one nation: its standing, relation buttons, a trade-deal form and calls to attack. */
export class DiplomacyPanel {
  readonly el = h('div', { class: 'diplomacy panel hidden' });
  private nation: NationId | null = null;
  private readonly swatch = h('span', { class: 'swatch' });
  private readonly name = h('span', { class: 'diplomacy-name' });
  private readonly badge = h('span', { class: 'badge' });
  private readonly stats = h('div', { class: 'diplomacy-stats' });
  private readonly actions = h('div', { class: 'diplomacy-actions' });
  private readonly inputs = new Map<keyof Deal, HTMLInputElement>();
  private readonly joint = h('div', { class: 'diplomacy-joint' });
  private readonly targets = h('select', { attrs: { 'aria-label': 'Target' } });
  private shownKey = '';

  constructor(
    private readonly state: ClientState,
    private readonly names: Map<NationId, string>,
    private readonly colors: Map<NationId, number>,
    private readonly send: (cmd: Command) => void,
  ) {
    const form = h('div', { class: 'deal-form' });
    for (const { key, label } of DEAL_FIELDS) {
      const input = h('input', { attrs: { type: 'number', min: '0', step: '1', value: '0', 'aria-label': label } });
      this.inputs.set(key, input);
      form.append(h('label', { class: 'deal-field' }, h('span', { text: label }), input));
    }
    this.joint.append(
      h('span', { class: 'panel-title', text: 'Ask to attack ▸' }),
      this.targets,
      h('button', { text: 'Ask', on: { click: () => this.askJoint() } }),
    );
    this.el.append(
      h('div', { class: 'diplomacy-head' }, this.swatch, this.name, this.badge,
        h('button', { class: 'close', text: '×', attrs: { 'aria-label': 'Close' }, on: { click: () => this.close() } })),
      this.stats,
      this.actions,
      h('div', { class: 'panel-title', text: 'Trade deal' }),
      form,
      h('button', { text: 'Offer deal', on: { click: () => this.offer(false) } }),
      this.joint,
    );
  }

  /** Opens the panel on nation `id`. */
  open(id: NationId): void {
    this.nation = id;
    this.shownKey = '';
    this.el.classList.remove('hidden');
    this.update();
  }

  close(): void {
    this.nation = null;
    this.el.classList.add('hidden');
  }

  update(): void {
    const id = this.nation;
    if (id === null) return;
    const n = this.state.nations.get(id);
    if (!n || !n.alive || this.state.phase === 'ended') {
      this.close();
      return;
    }
    setText(this.stats, `${formatNumber(n.troops)} troops · ${formatNumber(n.tiles)} tiles`);
    const targets = n.relationToPlayer === 'allied' ? jointTargets(this.state, id) : [];
    const key = `${id}|${n.relationToPlayer}|${n.embargoed}|${targets.join(',')}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.swatch.style.background = css(this.colors.get(id) ?? 0x808080);
    setText(this.name, this.names.get(id) ?? '');
    setText(this.badge, RELATION_LABELS[n.relationToPlayer]);
    this.badge.className = `badge ${n.relationToPlayer}`;
    this.actions.replaceChildren(...relationActions(n.relationToPlayer, n.embargoed).map((label) =>
      h('button', { text: label, on: { click: () => this.act(label, n.embargoed) } })));
    this.joint.classList.toggle('hidden', targets.length === 0);
    this.targets.replaceChildren(...targets.map((t) => h('option', { text: this.names.get(t) ?? String(t), attrs: { value: String(t) } })));
  }

  private act(label: string, embargoed: boolean): void {
    const id = this.nation;
    if (id === null) return;
    const nation = this.state.init.playerId;
    if (label === 'Propose alliance') this.send({ type: 'proposeAlliance', nation, to: id });
    else if (label === 'Break alliance') this.send({ type: 'breakAlliance', nation, with: id });
    else if (label === 'Propose peace') this.send({ type: 'proposePeace', nation, to: id });
    else if (label.startsWith('Embargo')) this.send({ type: 'embargo', nation, with: id, on: !embargoed });
    else if (label === 'Gift') this.offer(true);
  }

  private offer(gift: boolean): void {
    if (this.nation === null) return;
    const values = Object.fromEntries(DEAL_FIELDS.map(({ key }) => [key, this.inputs.get(key)!.value])) as Record<keyof Deal, string>;
    this.send({ type: 'proposeDeal', nation: this.state.init.playerId, to: this.nation, deal: dealFromForm(values, gift) });
  }

  private askJoint(): void {
    if (this.nation === null || this.targets.value === '') return;
    this.send({ type: 'requestJointAttack', nation: this.state.init.playerId, to: this.nation, target: Number(this.targets.value) });
  }
}
