import { GAME_NAME } from '../shared/constants';
import type { BuildingType, Command, Difficulty, MapChoice, MapSize } from '../shared/types';
import type { GameUpdate, InitPayload, StartOptions } from '../worker/protocol';
import { SimBridge } from './bridge';
import { Camera } from './camera';
import { Controls } from './input';
import { MapInfo } from './mapInfo';
import { Effects } from './render/effects';
import { GlMap } from './render/look/glMap';
import { buildTerrainLook } from './render/look/terrainLook';
import { Renderer } from './render/renderer';
import { UnitInterpolator } from './render/units';
import { ClientState } from './state';
import { installTestApi } from './testApi';
import { ContextMenu, menuEntries } from './ui/contextMenu';
import { DiplomacyPanel } from './ui/diplomacyPanel';
import { h, setText } from './ui/dom';
import { EndScreen } from './ui/endScreen';
import { EventFeed } from './ui/eventFeed';
import { Hud } from './ui/hud';
import { Leaderboard } from './ui/leaderboard';
import { PauseButton } from './ui/pauseButton';
import { createMenu } from './ui/menu';
import { RequestPopups } from './ui/requests';
import './styles.css';

/** Space kept between the fitted map and the bottom bar, in pixels. */
const HUD_GAP = 24;

document.title = GAME_NAME;
const params = new URLSearchParams(location.search);
const testMode = params.get('test') === '1';
const app = h('div', { class: 'app' });
document.body.append(app);

if (params.get('autostart') === '1') start(optionsFromUrl(params));
else app.append(createMenu(start, testMode));

/** Match options from the URL (?map=random&size=small&seed=7&bots=4&difficulty=easy). */
function optionsFromUrl(p: URLSearchParams): StartOptions {
  const seed = Math.max(1, Math.round(Number(p.get('seed')) || 1));
  const size = (['small', 'medium', 'large'].includes(p.get('size') ?? '') ? p.get('size') : 'medium') as MapSize;
  const map: MapChoice = p.get('map') === 'world' ? { kind: 'world' } : { kind: 'random', size, seed };
  const difficulty = (['easy', 'normal', 'hard', 'insane'].includes(p.get('difficulty') ?? '') ? p.get('difficulty') : 'normal') as Difficulty;
  return {
    map,
    bots: Math.min(40, Math.max(1, Math.round(Number(p.get('bots')) || 12))),
    difficulty,
    seed,
    playerName: p.get('name') || 'You',
    debug: testMode,
  };
}

function backToMenu(): void {
  location.href = `${import.meta.env.BASE_URL}${testMode ? '?test=1' : ''}`;
}

function start(options: StartOptions): void {
  app.replaceChildren();
  const glCanvas = h('canvas', { class: 'map-gl' });
  const canvas = h('canvas', { class: 'map' });
  const loading = h('div', { class: 'banner', text: 'Building the world…' });
  app.append(glCanvas, canvas, loading);
  const state = new ClientState();
  let ui: { update(): void } | null = null;

  const bridge = new SimBridge({
    onInit(init: InitPayload) {
      state.applyInit(init);
      loading.remove();
      ui = buildGame(canvas, glCanvas, state, bridge);
    },
    onUpdate(update: GameUpdate) {
      if (!state.init) return;
      state.applyUpdate(update);
      ui?.update();
    },
    onError(message: string) {
      app.append(h('div', { class: 'banner error', text: `Something went wrong: ${message}` }));
    },
  });
  bridge.start(options).catch((e: unknown) => {
    loading.remove();
    app.append(h('div', { class: 'banner error', text: e instanceof Error ? e.message : String(e) }));
  });
}

/**
 * Sets up the camera, renderer, panels and controls once the match exists; returns what to refresh on updates. The map
 * is drawn by the graphics chip on `glCanvas` unless that isn't available or the URL asks for ?look=flat.
 */
function buildGame(canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement, state: ClientState, bridge: SimBridge): { update(): void } {
  const { init } = state;
  const size = (): void => {
    for (const c of [canvas, glCanvas]) {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    }
  };
  size();
  const camera = new Camera(canvas.width, canvas.height, init.width, init.height);
  window.addEventListener('resize', () => {
    size();
    camera.resize(canvas.width, canvas.height);
  });
  const info = new MapInfo(init.width, init.height, init.terrain);
  const units = new UnitInterpolator();
  const effects = new Effects(state);
  state.onEvents = (events) => effects.onEvents(events, performance.now());
  const names = new Map(init.nations.map((n) => [n.id, n.name]));
  const colors = new Map(init.nations.map((n) => [n.id, n.color]));
  const gl = params.get('look') === 'flat'
    ? null
    : GlMap.create(glCanvas, buildTerrainLook(init.width, init.height, init.terrain, init.look), colors);
  if (!gl) glCanvas.remove();
  const renderer = new Renderer(canvas, state, camera, units, effects, gl);
  const send = (cmd: Command): void => bridge.send(cmd);
  let land = 0;
  for (const t of init.terrain) if (t !== 0) land++;

  const pause = new PauseButton((paused) => bridge.setPaused(paused));
  let controls: Controls | null = null;
  const hud = new Hud(state, (type) => selectBuild(type));
  const leaderboard = new Leaderboard(state);
  const feed = new EventFeed(state, names);
  const end = new EndScreen(state, Math.max(1, land), backToMenu);
  const banner = h('div', { class: 'banner' });
  const diplomacy = new DiplomacyPanel(state, names, colors, send);
  const requests = new RequestPopups(state, names, send);
  const menu = new ContextMenu();
  document.querySelector('.app')!.append(hud.el, leaderboard.el, pause.el, feed.el, diplomacy.el, requests.el, banner, menu.el, end.el);
  // fit the whole map in the space above the bottom bar
  camera.fitMap(hud.el.getBoundingClientRect().height + HUD_GAP);

  const canBuild = (type: BuildingType): boolean => {
    const button = hud.el.querySelector<HTMLButtonElement>(`button[data-building="${type}"]`);
    return button !== null && !button.disabled;
  };
  function selectBuild(type: BuildingType): void {
    if (!controls || !canBuild(type)) return;
    const current = controls.mode;
    controls.setMode(current.kind === 'build' && current.building === type ? { kind: 'default' } : { kind: 'build', building: type });
  }
  const menuContext = { state, info, send, ratio: () => hud.attackRatio, openDiplomacy: (id: number) => diplomacy.open(id) };
  controls = new Controls(canvas, camera, state, {
    send,
    attackRatio: () => hud.attackRatio,
    nudgeRatio: (step) => hud.nudgeRatio(step),
    togglePause: () => pause.toggle(),
    canBuild,
    onModeChange: (mode) => hud.setSelected(mode.kind === 'build' ? mode.building : null),
    openMenu: (tile, x, y) => menu.open(menuEntries(menuContext, tile), x, y),
    dismissMenu: () => {
      const open = menu.isOpen;
      menu.close();
      return open;
    },
  });
  if (testMode) installTestApi(state, info, camera, canvas, send, renderer);

  let last = performance.now();
  const loop = (now: number): void => {
    controls!.frame(Math.min(0.1, (now - last) / 1000));
    last = now;
    renderer.draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const updateBanner = (): void => {
    if (state.phase === 'spawn') {
      const secs = Math.max(0, Math.ceil((init.spawnEndsAt - state.tick) / 10));
      const picked = (state.player?.tiles ?? 0) > 0;
      setText(banner, picked ? `Good spot! The war starts in ${secs}s — click again to move.` : `Click where you want to start — ${secs}s left`);
      banner.classList.remove('hidden');
    } else if (controls?.mode.kind === 'build') {
      setText(banner, 'Click your land to place it — Esc to cancel');
      banner.classList.remove('hidden');
    } else banner.classList.add('hidden');
  };
  const update = (): void => {
    units.update(state.units, performance.now());
    hud.update();
    // a building that can no longer be afforded (or placed) ends placing mode
    const mode = controls?.mode;
    if (mode?.kind === 'build' && !canBuild(mode.building)) controls!.setMode({ kind: 'default' });
    diplomacy.update();
    requests.update();
    leaderboard.update();
    feed.update();
    end.update();
    updateBanner();
  };
  update();
  return { update };
}
