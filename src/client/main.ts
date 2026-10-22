import { GAME_NAME } from '../shared/constants';
import type { BuildingType, Difficulty, MapChoice, MapSize } from '../shared/types';
import type { GameUpdate, InitPayload, StartOptions } from '../worker/protocol';
import { SimBridge } from './bridge';
import { Camera } from './camera';
import { Controls } from './input';
import { Renderer } from './render/renderer';
import { ClientState } from './state';
import { installTestApi } from './testApi';
import { h, setText } from './ui/dom';
import { EndScreen } from './ui/endScreen';
import { EventFeed } from './ui/eventFeed';
import { Hud } from './ui/hud';
import { Leaderboard } from './ui/leaderboard';
import { createMenu } from './ui/menu';
import { SpeedControls } from './ui/speedControls';
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
  const canvas = h('canvas', { class: 'map' });
  const loading = h('div', { class: 'banner', text: 'Building the world…' });
  app.append(canvas, loading);
  const state = new ClientState();
  let ui: { update(): void } | null = null;

  const bridge = new SimBridge({
    onInit(init: InitPayload) {
      state.applyInit(init);
      loading.remove();
      ui = buildGame(canvas, state, bridge);
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

/** Sets up the camera, renderer, panels and controls once the match exists; returns what to refresh on updates. */
function buildGame(canvas: HTMLCanvasElement, state: ClientState, bridge: SimBridge): { update(): void } {
  const { init } = state;
  const size = (): void => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  size();
  const camera = new Camera(canvas.width, canvas.height, init.width, init.height);
  window.addEventListener('resize', () => {
    size();
    camera.resize(canvas.width, canvas.height);
  });
  const renderer = new Renderer(canvas, state, camera);
  const names = new Map(init.nations.map((n) => [n.id, n.name]));
  let land = 0;
  for (const t of init.terrain) if (t !== 0) land++;

  const speed = new SpeedControls((s) => bridge.setSpeed(s));
  let controls: Controls | null = null;
  const hud = new Hud(state, (type) => selectBuild(type));
  const leaderboard = new Leaderboard(state);
  const feed = new EventFeed(state, names);
  const end = new EndScreen(state, Math.max(1, land), backToMenu);
  const banner = h('div', { class: 'banner' });
  document.querySelector('.app')!.append(hud.el, leaderboard.el, speed.el, feed.el, banner, end.el);
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
  controls = new Controls(canvas, camera, state, {
    send: (cmd) => bridge.send(cmd),
    attackRatio: () => hud.attackRatio,
    nudgeRatio: (step) => hud.nudgeRatio(step),
    togglePause: () => speed.togglePause(),
    canBuild,
    onModeChange: (mode) => hud.setSelected(mode.kind === 'build' ? mode.building : null),
  });
  if (testMode) installTestApi(state, camera, canvas, (cmd) => bridge.send(cmd));

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
    hud.update();
    leaderboard.update();
    feed.update();
    end.update();
    updateBanner();
  };
  update();
  return { update };
}
