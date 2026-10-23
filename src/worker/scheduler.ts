/**
 * Turns wall-clock time into simulation ticks: one tick per `tickMs`, none while paused. Never runs more than
 * `maxCatchUp` ticks per call: after a long gap (a background tab, a slow frame) the excess backlog is dropped rather
 * than replayed, so the game can't spiral. Paused time is never replayed either.
 */
export class TickScheduler {
  private paused = false;
  private last: number | null = null;
  /** Ticks owed but not yet run, as a fraction. */
  private owed = 0;

  constructor(private readonly tickMs: number, private readonly maxCatchUp: number) {}

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** The ticks to run now, at `nowMs`. The first call only starts the clock. */
  due(nowMs: number): number {
    if (this.last === null) {
      this.last = nowMs;
      return 0;
    }
    const elapsed = Math.max(0, nowMs - this.last);
    this.last = nowMs;
    if (this.paused) return 0;
    this.owed += elapsed / this.tickMs;
    const n = Math.floor(this.owed);
    if (n > this.maxCatchUp) {
      this.owed = 0;
      return this.maxCatchUp;
    }
    this.owed -= n;
    return n;
  }
}
