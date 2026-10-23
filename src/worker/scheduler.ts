/** Game speeds: 0 is paused. */
export type Speed = 0 | 1 | 2 | 4;

/**
 * Turns wall-clock time into simulation ticks: one tick per `tickMs` at 1×, more at higher speeds. Never runs more
 * than `maxCatchUp` ticks per call: after a long gap (a background tab, a slow frame) the excess backlog is dropped
 * rather than replayed, so the game can't spiral. Paused time is never replayed either.
 */
export class TickScheduler {
  private speed: Speed = 1;
  private last: number | null = null;
  /** Ticks owed but not yet run, as a fraction. */
  private owed = 0;

  constructor(private readonly tickMs: number, private readonly maxCatchUp: number) {}

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  /** The ticks to run now, at `nowMs`. The first call only starts the clock. */
  due(nowMs: number): number {
    if (this.last === null) {
      this.last = nowMs;
      return 0;
    }
    const elapsed = Math.max(0, nowMs - this.last);
    this.last = nowMs;
    this.owed += (elapsed * this.speed) / this.tickMs;
    const n = Math.floor(this.owed);
    if (n > this.maxCatchUp) {
      this.owed = 0;
      return this.maxCatchUp;
    }
    this.owed -= n;
    return n;
  }
}
