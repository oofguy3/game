import { describe, expect, it } from 'vitest';
import { encodeWav, synthesize, SYNTH_NAMES } from './synth';

describe('synthesize', () => {
  it.each(SYNTH_NAMES)('%s is 0.1–3 s long, never clips, and is not silent', (name) => {
    const s = synthesize(name, 44100);
    expect(s.length / 44100).toBeGreaterThanOrEqual(0.1);
    expect(s.length / 44100).toBeLessThanOrEqual(3);
    let peak = 0;
    let energy = 0;
    for (const v of s) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
      energy += v * v;
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(Math.sqrt(energy / s.length)).toBeGreaterThan(0.01);
  });

  it('comes out the same every time', () => {
    expect(synthesize('jet', 22050)).toEqual(synthesize('jet', 22050));
  });

  it('makes every sound the catalogue says is made in code', () => {
    expect([...SYNTH_NAMES].sort()).toEqual(['betrayal', 'declined', 'defeat', 'horn', 'jet', 'knockout', 'radar', 'send', 'victory', 'warning']);
  });
});

describe('encodeWav', () => {
  it('writes a mono 16-bit RIFF header followed by the samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 8000);
    const view = new DataView(wav.buffer);
    const text = (at: number): string => String.fromCharCode(...wav.slice(at, at + 4));
    expect(text(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 6);
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(6);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([0, 32767, -32767]);
  });
});
