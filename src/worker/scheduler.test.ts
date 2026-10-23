import { describe, expect, it } from 'vitest';
import { TickScheduler } from './scheduler';

describe('TickScheduler', () => {
  it('runs 1 tick per 100 ms', () => {
    const s = new TickScheduler(100, 8);
    expect(s.due(0)).toBe(0);
    expect(s.due(100)).toBe(1);
    expect(s.due(150)).toBe(0);
    expect(s.due(200)).toBe(1); // the 50 ms left over carries
    expect(s.due(500)).toBe(3);
  });

  it('paused runs zero ticks', () => {
    const s = new TickScheduler(100, 8);
    s.setPaused(true);
    s.due(0);
    expect(s.due(5000)).toBe(0);
    // resuming doesn't replay the paused time
    s.setPaused(false);
    expect(s.due(5100)).toBe(1);
  });

  it('caps catch-up after a long gap', () => {
    const s = new TickScheduler(100, 8);
    s.due(0);
    expect(s.due(60_000)).toBe(8);
    expect(s.due(60_100)).toBe(1);
  });
});
