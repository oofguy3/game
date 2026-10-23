import { describe, expect, it } from 'vitest';
import { WebAudioOutput } from './webAudio';

describe('WebAudioOutput', () => {
  it('without Web Audio it stays silent: state none, play returns 0, nothing throws', () => {
    const out = new WebAudioOutput('/game/', undefined);
    out.unlock();
    expect(out.state).toBe('none');
    expect(out.play('click', 1)).toBe(0);
    expect(() => {
      out.setMasterGain(0.5);
      out.suspend();
      out.resume();
    }).not.toThrow();
  });

  it('stays silent when creating the audio context fails', () => {
    const Failing = class { constructor() { throw new Error('no audio device'); } } as unknown as new () => AudioContext;
    const out = new WebAudioOutput('/game/', Failing);
    expect(() => out.unlock()).not.toThrow();
    expect(out.state).toBe('none');
    expect(out.play('click', 1)).toBe(0);
  });
});
