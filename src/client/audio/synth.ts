/**
 * The sounds made in code rather than recorded: the sound packs have nothing like them, or don't say which of their
 * tunes are happy and which are sad. scripts/build-sounds.ts renders them to files once; the game only plays files.
 */
export type SynthName = 'send' | 'horn' | 'jet' | 'warning' | 'radar' | 'declined' | 'betrayal' | 'knockout' | 'victory' | 'defeat';
export const SYNTH_NAMES: readonly SynthName[] = ['send', 'horn', 'jet', 'warning', 'radar', 'declined', 'betrayal', 'knockout', 'victory', 'defeat'];

const PEAK = 0.9;
/** Sounds that would sound much louder than the rest at the same peak (square waves, bare tones) peak lower. */
const LEVEL: Partial<Record<SynthName, number>> = { warning: 0.4, declined: 0.7 };
const TAU = Math.PI * 2;
type Wave = (phase: number) => number;

const saw: Wave = (p) => 2 * (p - Math.floor(p + 0.5));
const square: Wave = (p) => (p - Math.floor(p) < 0.5 ? 1 : -1);
const triangle: Wave = (p) => 1 - 4 * Math.abs(p - Math.floor(p + 0.5));
const sine: Wave = (p) => Math.sin(TAU * p);

/** Fixed-seed noise in [-1, 1), so a sound comes out the same every time. */
function noiseSource(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

/** A state-variable band-pass filter, one sample per call. */
function bandPass(rate: number): (x: number, freq: number, q: number) => number {
  let low = 0;
  let band = 0;
  return (x, freq, q) => {
    const f = 2 * Math.sin((Math.PI * Math.min(freq, rate / 6)) / rate);
    low += f * band;
    const high = x - low - band / q;
    band += f * high;
    return band;
  };
}

/** A one-pole low-pass filter, one sample per call. */
function lowPass(rate: number): (x: number, freq: number) => number {
  let y = 0;
  return (x, freq) => {
    y += (1 - Math.exp((-TAU * freq) / rate)) * (x - y);
    return y;
  };
}

/** Adds a tone of `wave` at `freq` Hz from `start` for `dur` seconds: quick attack, exponential decay, soft end. */
function note(out: Float32Array, rate: number, start: number, dur: number, freq: number, wave: Wave, gain: number, decay = dur, vibrato = 0): void {
  const i0 = Math.floor(start * rate);
  const n = Math.floor(dur * rate);
  let phase = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const t = i / rate;
    phase += (freq * (1 + vibrato * Math.sin(TAU * 5 * t))) / rate;
    const env = Math.min(1, t / 0.008) * Math.exp(-t / decay) * Math.min(1, (dur - t) / 0.02);
    out[i0 + i] += gain * env * wave(phase);
  }
}

/** Filtered noise swept from `from` to `to` Hz (exponentially), shaped by `shape(t / length)`. */
function sweep(out: Float32Array, rate: number, seed: number, from: number, to: number, q: number, shape: (u: number) => number): void {
  const noise = noiseSource(seed);
  const filter = bandPass(rate);
  for (let i = 0; i < out.length; i++) {
    const u = i / out.length;
    out[i] = filter(noise(), from * (to / from) ** u, q) * shape(u);
  }
}

function lowPassAll(out: Float32Array, rate: number, freq: (u: number) => number): void {
  const filter = lowPass(rate);
  for (let i = 0; i < out.length; i++) out[i] = filter(out[i], freq(i / out.length));
}

const C4 = 261.63;
const EB4 = 311.13;
const G4 = 392.0;
const C5 = 523.25;
const E5 = 659.26;
const G5 = 783.99;
const C6 = 1046.5;

/** Renders sound `name` at `rate` samples per second, peaking at 0.9 (scaled by its LEVEL). */
export function synthesize(name: SynthName, rate: number): Float32Array {
  const buffer = (seconds: number): Float32Array => new Float32Array(Math.round(seconds * rate));
  let out: Float32Array;
  switch (name) {
    case 'send': // a whoosh
      out = buffer(0.35);
      sweep(out, rate, 7, 400, 2400, 1.2, (u) => Math.sin(Math.PI * u) ** 1.5);
      break;
    case 'jet': // noise rising past, loudest in the middle
      out = buffer(0.9);
      sweep(out, rate, 11, 300, 1800, 0.8, (u) => Math.sin(Math.PI * u) ** 2);
      lowPassAll(out, rate, () => 4000);
      break;
    case 'horn': { // a ship's horn: two low saws, a slow start, a little wobble
      out = buffer(1.2);
      for (const [freq, gain] of [[110, 0.5], [110.6, 0.4], [165, 0.35]] as const) note(out, rate, 0, 1.2, freq, saw, gain, 4, 0.004);
      lowPassAll(out, rate, () => 900);
      for (let i = 0; i < out.length; i++) out[i] *= Math.min(1, i / rate / 0.15) * Math.min(1, (out.length - i) / rate / 0.35);
      break;
    }
    case 'warning': // a two-tone alarm
      out = buffer(0.5);
      note(out, rate, 0, 0.18, 880, square, 0.5, 1);
      note(out, rate, 0.24, 0.18, 660, square, 0.5, 1);
      lowPassAll(out, rate, () => 3000);
      break;
    case 'radar': // a ping with a ringing tail
      out = buffer(0.6);
      note(out, rate, 0, 0.6, 1400, sine, 0.8, 0.12);
      note(out, rate, 0, 0.6, 2800, sine, 0.25, 0.06);
      break;
    case 'declined': // a low falling pair
      out = buffer(0.4);
      note(out, rate, 0, 0.18, C5, triangle, 0.6, 0.15);
      note(out, rate, 0.18, 0.22, G4, triangle, 0.6, 0.2);
      break;
    case 'betrayal': // a sharp, sour stab
      out = buffer(0.7);
      for (const freq of [220, 233.08, 329.63]) note(out, rate, 0, 0.7, freq, saw, 0.35, 0.25);
      lowPassAll(out, rate, (u) => 3000 * (500 / 3000) ** u);
      break;
    case 'knockout': // a quick rising "ta-da"
      out = buffer(0.5);
      for (const [start, dur, freq] of [[0, 0.14, C5], [0.14, 0.36, E5]] as const) {
        note(out, rate, start, dur, freq, triangle, 0.5, 0.25);
        note(out, rate, start, dur, freq, square, 0.15, 0.25);
      }
      break;
    case 'victory': // a bright arpeggio, then the chord held
      out = buffer(2.2);
      [C5, E5, G5, C6].forEach((freq, i) => {
        note(out, rate, i * 0.14, 0.16, freq, saw, 0.3);
        note(out, rate, i * 0.14, 0.16, freq, triangle, 0.3);
      });
      for (const freq of [C5, E5, G5, C6]) {
        note(out, rate, 0.56, 1.64, freq, saw, 0.16, 0.9, 0.003);
        note(out, rate, 0.56, 1.64, freq, triangle, 0.2, 0.9, 0.003);
      }
      lowPassAll(out, rate, () => 2500);
      break;
    case 'defeat': // slow falling minor notes over a low drone
      out = buffer(2.4);
      note(out, rate, 0, 0.35, G4, triangle, 0.5, 0.5);
      note(out, rate, 0.35, 0.35, EB4, triangle, 0.5, 0.5);
      note(out, rate, 0.7, 1.7, C4, triangle, 0.55, 0.9);
      note(out, rate, 0.7, 1.7, C4 / 2, saw, 0.25, 1.2);
      lowPassAll(out, rate, () => 1800);
      break;
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const scale = (PEAK * (LEVEL[name] ?? 1)) / peak;
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/** `samples` (−1…1, mono) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return bytes;
}
