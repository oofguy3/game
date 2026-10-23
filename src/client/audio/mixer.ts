import type { KeyValue } from '../storage';
import { SOUNDS } from './catalog';
import type { SoundName } from './catalog';

/** Where sounds go: `play` starts one at `gain` and says how long it lasts in ms (0 if it couldn't play). */
export interface SoundOutput {
  play(name: SoundName, gain: number): number;
  setMasterGain(gain: number): void;
}

export interface SoundSettings {
  muted: boolean;
  volume: number;
}

export const SETTINGS_KEY = 'borderline.sound';
export const MAX_VOICES = 8;
export const GROUP_GAIN = { ui: 0.6, action: 0.6, alert: 0.9 } as const;
const DEFAULTS: SoundSettings = { muted: false, volume: 0.5 };
/** How many recent sounds `played` keeps. */
const HISTORY = 50;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Plays the sounds the director asks for, tidily: each sound at least its gap apart, at most MAX_VOICES at once, only
 * button clicks while the game is paused, nothing while muted. The volume (and mute) is the master gain, remembered
 * in `storage`.
 */
export class Mixer {
  /** The latest sounds that played, oldest first (for tests). */
  readonly played: SoundName[] = [];
  private readonly current: SoundSettings;
  private paused = false;
  private readonly lastPlayed = new Map<SoundName, number>();
  /** When each sound now playing ends. */
  private voices: number[] = [];

  constructor(private readonly out: SoundOutput, private readonly now: () => number, private readonly storage: KeyValue) {
    this.current = load(storage);
    this.applyMaster();
  }

  get settings(): SoundSettings {
    return { ...this.current };
  }

  setMuted(muted: boolean): void {
    this.current.muted = muted;
    this.changed();
  }

  setVolume(volume: number): void {
    this.current.volume = clamp01(Number.isFinite(volume) ? volume : 0);
    this.changed();
  }

  setGamePaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Plays `name` if the rules allow; whether it played. */
  play(name: SoundName): boolean {
    if (this.current.muted) return false;
    const spec = SOUNDS[name];
    if (this.paused && spec.group !== 'ui') return false;
    const t = this.now();
    const last = this.lastPlayed.get(name);
    if (last !== undefined && t - last < spec.gapMs) return false;
    this.voices = this.voices.filter((end) => end > t);
    if (this.voices.length >= MAX_VOICES) return false;
    const ms = this.out.play(name, GROUP_GAIN[spec.group] * (spec.volume ?? 1));
    if (ms <= 0) return false;
    this.lastPlayed.set(name, t);
    this.voices.push(t + ms);
    this.played.push(name);
    if (this.played.length > HISTORY) this.played.shift();
    return true;
  }

  private changed(): void {
    this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.current));
    this.applyMaster();
  }

  private applyMaster(): void {
    this.out.setMasterGain(this.current.muted ? 0 : this.current.volume);
  }
}

/** The saved settings, or the defaults when there are none or they don't make sense. */
function load(storage: KeyValue): SoundSettings {
  const raw = storage.getItem(SETTINGS_KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const saved = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      muted: saved.muted === true,
      volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) ? clamp01(saved.volume) : DEFAULTS.volume,
    };
  } catch {
    return { ...DEFAULTS };
  }
}
