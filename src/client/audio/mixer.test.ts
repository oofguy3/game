import { describe, expect, it } from 'vitest';
import { safeStorage } from '../storage';
import type { SoundName } from './catalog';
import { GROUP_GAIN, MAX_VOICES, Mixer, SETTINGS_KEY } from './mixer';
import type { SoundOutput } from './mixer';

class FakeOutput implements SoundOutput {
  calls: [SoundName, number][] = [];
  master: number[] = [];
  length = 300;
  play(name: SoundName, gain: number): number {
    this.calls.push([name, gain]);
    return this.length;
  }
  setMasterGain(gain: number): void {
    this.master.push(gain);
  }
}

function setup(saved: string | null = null) {
  const map = new Map<string, string>();
  if (saved !== null) map.set(SETTINGS_KEY, saved);
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  const out = new FakeOutput();
  let t = 0;
  const mixer = new Mixer(out, () => t, storage);
  return { out, map, mixer, at: (ms: number) => { t = ms; } };
}

describe('Mixer', () => {
  it('starts unmuted at half volume', () => {
    const { mixer, out } = setup();
    expect(mixer.settings).toEqual({ muted: false, volume: 0.5 });
    expect(out.master.at(-1)).toBe(0.5);
  });

  it('loads and saves its settings under borderline.sound', () => {
    const { mixer, out, map } = setup('{"muted":true,"volume":0.3}');
    expect(SETTINGS_KEY).toBe('borderline.sound');
    expect(mixer.settings).toEqual({ muted: true, volume: 0.3 });
    expect(out.master.at(-1)).toBe(0);
    mixer.setVolume(0.8);
    mixer.setMuted(false);
    expect(JSON.parse(map.get(SETTINGS_KEY)!)).toEqual({ muted: false, volume: 0.8 });
    expect(out.master.at(-1)).toBe(0.8);
  });

  it('falls back to its defaults when the saved settings are broken or storage throws', () => {
    expect(setup('not json').mixer.settings).toEqual({ muted: false, volume: 0.5 });
    expect(setup('{"volume":"loud"}').mixer.settings).toEqual({ muted: false, volume: 0.5 });
    const broken = safeStorage(() => ({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }) as unknown as Storage);
    const mixer = new Mixer(new FakeOutput(), () => 0, broken);
    expect(mixer.settings).toEqual({ muted: false, volume: 0.5 });
    expect(() => mixer.setMuted(true)).not.toThrow();
  });

  it('keeps each sound its gap apart', () => {
    const { mixer, at } = setup();
    expect(mixer.play('thud')).toBe(true);
    at(200);
    expect(mixer.play('thud')).toBe(false);
    at(330);
    expect(mixer.play('thud')).toBe(true);
  });

  it('plays at most 8 sounds at once', () => {
    const { mixer, out, at } = setup();
    out.length = 1000;
    const names: SoundName[] = ['place', 'built', 'send', 'thud', 'horn', 'jet', 'boom', 'landing', 'refused'];
    expect(MAX_VOICES).toBe(8);
    expect(names.map((n) => mixer.play(n))).toEqual([true, true, true, true, true, true, true, true, false]);
    at(1000);
    expect(mixer.play('refused')).toBe(true);
  });

  it('plays nothing while muted', () => {
    const { mixer, out } = setup();
    mixer.setMuted(true);
    expect(mixer.play('warning')).toBe(false);
    expect(out.calls).toEqual([]);
  });

  it('plays only button clicks while the game is paused', () => {
    const { mixer } = setup();
    mixer.setGamePaused(true);
    expect(mixer.play('thud')).toBe(false);
    expect(mixer.play('warning')).toBe(false);
    expect(mixer.play('click')).toBe(true);
    mixer.setGamePaused(false);
    expect(mixer.play('thud')).toBe(true);
  });

  it('passes the group gain to the output (alert 0.9, action 0.6) and the volume to the master gain, clamped 0–1', () => {
    const { mixer, out } = setup();
    expect(GROUP_GAIN).toEqual({ ui: 0.6, action: 0.6, alert: 0.9 });
    mixer.play('warning');
    mixer.play('built');
    mixer.play('thud');
    expect(out.calls).toEqual([['warning', 0.9], ['built', 0.6], ['thud', expect.closeTo(0.36, 10)]]);
    mixer.setVolume(2);
    expect(out.master.at(-1)).toBe(1);
    mixer.setVolume(-1);
    expect(out.master.at(-1)).toBe(0);
  });

  it('a sound that could not play (not loaded yet) does not use up its gap', () => {
    const { mixer, out } = setup();
    out.length = 0;
    expect(mixer.play('thud')).toBe(false);
    out.length = 300;
    expect(mixer.play('thud')).toBe(true);
    expect(mixer.played).toEqual(['thud']);
  });
});
