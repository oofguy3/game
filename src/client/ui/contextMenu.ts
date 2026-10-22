import { CONFIG } from '../../shared/config';
import { BUILDING_TYPES } from '../../shared/types';
import type { BuildingType, Command, NationId, TileIndex } from '../../shared/types';
import type { BuildingSnap } from '../../worker/protocol';
import { formatNumber } from '../format';
import type { MapInfo } from '../mapInfo';
import type { ClientState } from '../state';
import { h } from './dom';
import { playerBuildingCost } from './hud';
import { BUILDING_LABELS } from './labels';

/** One line of the right-click menu: what it says, why it is greyed out (or a price), what it does, or a submenu. */
export interface MenuEntry {
  label: string;
  detail?: string;
  disabled?: boolean;
  run?: () => void;
  submenu?: MenuEntry[];
}

export interface MenuContext {
  state: ClientState;
  info: MapInfo;
  send(cmd: Command): void;
  /** The attack-size slider's share of troops. */
  ratio(): number;
  openDiplomacy(nation: NationId): void;
}

const COAST_ONLY: readonly BuildingType[] = ['port', 'navalBase'];

/**
 * What a right-click on `tile` offers the player while the game is on:
 * - Attack, on land that isn't theirs (greyed out on an ally's);
 * - Send boat, on coastal land that isn't theirs;
 * - Bomb and Paratroopers, always, greyed out with the reason when they can't go;
 * - Build ▸, on their land; Build warship / Build fighter, at their own naval base / airport;
 * - Move nearest warship here, on water when they have a warship;
 * - Diplomacy with <owner>, on another nation's land.
 */
export function menuEntries(ctx: MenuContext, tile: TileIndex): MenuEntry[] {
  const { state, info, send } = ctx;
  const player = state.player;
  if (state.phase !== 'playing' || !player?.alive) return [];
  const me = state.init.playerId;
  const owner = state.owner[tile];
  const land = info.isLand(tile);
  const allied = owner !== 0 && owner !== me && state.nations.get(owner)?.relationToPlayer === 'allied';
  const entries: MenuEntry[] = [];

  if (land && owner !== me) {
    entries.push({
      label: 'Attack', disabled: allied, detail: allied ? 'allied' : undefined,
      run: () => send({ type: 'attack', nation: me, tile, ratio: ctx.ratio(), allowBoat: true }),
    });
    if (info.coastal[tile]) {
      entries.push({
        label: 'Send boat', disabled: allied, detail: allied ? 'allied' : undefined,
        run: () => send({ type: 'boat', nation: me, tile, ratio: ctx.ratio() }),
      });
    }
  }
  entries.push(airEntry(ctx, tile, 'Bomb', () => send({ type: 'bomb', nation: me, tile })));
  entries.push(airEntry(ctx, tile, 'Paratroopers', () => send({ type: 'paradrop', nation: me, tile, ratio: ctx.ratio() })));

  if (owner === me) {
    entries.push({
      label: 'Build ▸',
      submenu: BUILDING_TYPES.map((type) => {
        const cost = playerBuildingCost(state, type);
        const offCoast = COAST_ONLY.includes(type) && info.coastal[tile] === 0;
        return {
          label: BUILDING_LABELS[type], detail: offCoast ? 'coast only' : formatNumber(cost),
          disabled: offCoast || cost > player.gold,
          run: () => send({ type: 'build', nation: me, building: type, tile }),
        };
      }),
    });
    const base = ownBuildingAt(ctx, tile, 'navalBase');
    if (base) entries.push({ label: 'Build warship', run: () => send({ type: 'buildUnit', nation: me, unit: 'warship', buildingId: base.id }) });
    const airport = ownBuildingAt(ctx, tile, 'airport');
    if (airport) entries.push({ label: 'Build fighter', run: () => send({ type: 'buildUnit', nation: me, unit: 'fighter', buildingId: airport.id }) });
  }

  if (!land) {
    const x = tile % info.width;
    const y = Math.floor(tile / info.width);
    let ship: { id: number; d: number } | null = null;
    for (const u of state.units) {
      if (u.owner !== me || u.type !== 'warship') continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (ship === null || d < ship.d) ship = { id: u.id, d };
    }
    if (ship) {
      const unitId = ship.id;
      entries.push({ label: 'Move nearest warship here', run: () => send({ type: 'moveUnit', nation: me, unitId, tile }) });
    }
  }

  if (owner !== 0 && owner !== me) {
    const name = state.init.nations.find((n) => n.id === owner)?.name ?? 'them';
    entries.push({ label: `Diplomacy with ${name}`, run: () => ctx.openDiplomacy(owner) });
  }
  return entries;
}

/** A finished building of the player's of `type` on `tile` or right next to it (icons are bigger than tiles). */
function ownBuildingAt(ctx: MenuContext, tile: TileIndex, type: BuildingType): BuildingSnap | undefined {
  const { state, info } = ctx;
  const x = tile % info.width;
  const y = Math.floor(tile / info.width);
  return state.buildings.find((b) => b.owner === state.init.playerId && b.type === type && !b.underConstruction
    && Math.max(Math.abs((b.tile % info.width) - x), Math.abs(Math.floor(b.tile / info.width) - y)) <= 1);
}

/** A bomb or paratroop entry, greyed out with the reason the simulation would give when it can't go. */
function airEntry(ctx: MenuContext, tile: TileIndex, label: 'Bomb' | 'Paratroopers', run: () => void): MenuEntry {
  const reason = airReason(ctx, tile, label === 'Bomb');
  return reason === null ? { label, run } : { label, run, disabled: true, detail: reason };
}

function airReason(ctx: MenuContext, tile: TileIndex, bomb: boolean): string | null {
  const { state, info } = ctx;
  const me = state.init.playerId;
  const owner = state.owner[tile];
  if (!bomb && !info.isLand(tile)) return 'not land';
  if (owner === me) return 'your land';
  if (bomb && owner === 0) return 'nobody owns that';
  if (owner !== 0 && state.nations.get(owner)?.relationToPlayer === 'allied') return 'allied';
  const airports = state.buildings.filter((b) => b.owner === me && b.type === 'airport' && !b.underConstruction);
  if (airports.length === 0) return 'no airport';
  const x = tile % info.width;
  const y = Math.floor(tile / info.width);
  const range = CONFIG.buildings.airport.range;
  const inRange = airports.some((a) => Math.hypot((a.tile % info.width) - x, Math.floor(a.tile / info.width) - y) <= range);
  return inRange ? null : 'out of range';
}

/** The right-click menu on the page: a small panel of buttons at the cursor, closed by a pick, Esc or a click away. */
export class ContextMenu {
  readonly el = h('div', { class: 'context-menu panel hidden' });
  private at = { x: 0, y: 0 };

  constructor() {
    window.addEventListener('mousedown', (e) => {
      if (this.isOpen && !this.el.contains(e.target as Node) && (e.target as HTMLElement).tagName !== 'CANVAS') this.close();
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  /** Shows `entries` at page point (x, y); nothing to show closes it instead. */
  open(entries: MenuEntry[], x: number, y: number): void {
    if (entries.length === 0) {
      this.close();
      return;
    }
    this.at = { x, y };
    this.render(entries, null);
  }

  close(): void {
    this.el.classList.add('hidden');
    this.el.replaceChildren();
  }

  private render(entries: MenuEntry[], back: MenuEntry[] | null): void {
    const buttons = entries.map((e) => {
      const button = h('button', {
        class: 'menu-item',
        on: {
          click: () => {
            if (e.submenu) this.render(e.submenu, entries);
            else {
              this.close();
              e.run?.();
            }
          },
        },
      }, h('span', { class: 'menu-label', text: e.label }), e.detail ? h('span', { class: 'menu-detail', text: e.detail }) : null);
      button.disabled = e.disabled === true;
      return button;
    });
    const header = back ? h('button', { class: 'menu-item menu-back', text: '‹ Back', on: { click: () => this.render(back, null) } }) : null;
    this.el.replaceChildren(...(header ? [header] : []), ...buttons);
    this.el.classList.remove('hidden');
    // keep it on screen
    const r = this.el.getBoundingClientRect();
    const left = Math.max(4, Math.min(this.at.x, window.innerWidth - r.width - 4));
    const top = Math.max(4, Math.min(this.at.y, window.innerHeight - r.height - 4));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }
}
