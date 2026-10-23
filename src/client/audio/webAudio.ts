import { SOUNDS } from './catalog';
import type { SoundName } from './catalog';
import type { SoundOutput } from './mixer';

/**
 * Plays the sound files through Web Audio: each sound through its own gain, then one master gain (the volume). The
 * audio context can only start on a click or key press, so `unlock` creates it then, and starts loading the files.
 * Without Web Audio, or before a file has loaded, sounds are simply skipped.
 */
export class WebAudioOutput implements SoundOutput {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private masterGain = 1;
  private loading = false;
  private readonly buffers = new Map<string, AudioBuffer>();
  /** Which variant of each sound plays next. */
  private readonly turn = new Map<SoundName, number>();

  constructor(private readonly baseUrl: string, private readonly ctor: (new () => AudioContext) | undefined = globalThis.AudioContext) {}

  get state(): AudioContextState | 'none' {
    return this.ctx?.state ?? 'none';
  }

  /** Creates (or resumes) the audio context; call it from a click or key press. */
  unlock(): void {
    if (!this.ctor) return;
    try {
      if (!this.ctx) {
        const ctx = new this.ctor();
        const master = ctx.createGain();
        master.gain.value = this.masterGain;
        master.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      if (!this.loading) {
        this.loading = true;
        void this.load(this.ctx);
      }
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  play(name: SoundName, gain: number): number {
    const { ctx, master } = this;
    if (!ctx || !master || ctx.state !== 'running') return 0;
    const { files } = SOUNDS[name];
    const i = this.turn.get(name) ?? 0;
    this.turn.set(name, (i + 1) % files.length);
    const buffer = this.buffers.get(files[i]);
    if (!buffer) return 0;
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const level = ctx.createGain();
      level.gain.value = gain;
      source.connect(level).connect(master);
      source.start();
      return buffer.duration * 1000;
    } catch {
      return 0;
    }
  }

  setMasterGain(gain: number): void {
    this.masterGain = gain;
    if (this.master) this.master.gain.value = gain;
  }

  suspend(): void {
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /** Fetches and decodes every sound file; a file that fails just stays silent. */
  private async load(ctx: AudioContext): Promise<void> {
    const files = new Set(Object.values(SOUNDS).flatMap((s) => s.files));
    await Promise.all([...files].map(async (file) => {
      try {
        const res = await fetch(`${this.baseUrl}sounds/${file}`);
        if (!res.ok) return;
        this.buffers.set(file, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // this sound stays silent
      }
    }));
  }
}
