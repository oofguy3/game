import type { Command } from '../shared/types';
import type { FromWorker, GameUpdate, InitPayload, StartOptions, ToWorker } from '../worker/protocol';

export interface BridgeHandlers {
  onInit(init: InitPayload): void;
  onUpdate(update: GameUpdate): void;
  onError(message: string): void;
}

/** The page's connection to the simulation worker. */
export class SimBridge {
  private worker: Worker | null = null;

  constructor(private readonly handlers: BridgeHandlers) {}

  /** Starts a match: loads the world map first when it's the one chosen. */
  async start(options: StartOptions): Promise<void> {
    let worldMap: ArrayBuffer | undefined;
    if (options.map.kind === 'world') {
      const res = await fetch(`${import.meta.env.BASE_URL}maps/world.bin`);
      if (!res.ok) throw new Error(`Couldn't load the world map (HTTP ${res.status})`);
      worldMap = await res.arrayBuffer();
    }
    this.stop();
    const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === 'init') this.handlers.onInit(msg.init);
      else if (msg.type === 'update') this.handlers.onUpdate(msg.update);
      else this.handlers.onError(msg.message);
    };
    worker.onerror = (e) => this.handlers.onError(e.message || 'The game stopped unexpectedly');
    this.worker = worker;
    this.post({ type: 'start', options, worldMap }, worldMap ? [worldMap] : []);
  }

  /** Sends a command as the player. */
  send(command: Command): void {
    this.post({ type: 'command', command });
  }

  setPaused(paused: boolean): void {
    this.post({ type: 'pause', paused });
  }

  /** Ends the match and its worker. */
  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }
}
