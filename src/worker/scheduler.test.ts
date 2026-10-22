import { describe, expect, it } from 'vitest';
import { TickScheduler } from './scheduler';

describe('TickScheduler', () => {
  it('1 tick per 100 ms at 1×, 4 at 4×', () => {
    const s = new TickScheduler(100, 8);
    expect(s.due(0)).toBe(0);
    expect(s.due(100)).toBe(1);
    expect(s.due(150)).toBe(0);
    expect(s.due(200)).toBe(1); // the 50 ms left over carries
    s.setSpeed(4);
    expect(s.due(300)).toBe(4);
    s.setSpeed(2);
    expect(s.due(400)).toBe(2);
  });

  it('paused runs zero ticks', () => {
    const s = new TickScheduler(100, 8);
    s.setSpeed(0);
    s.due(0);
    expect(s.due(5000)).toBe(0);
    // resuming doesn't replay the paused time
    s.setSpeed(1);
    expect(s.due(5100)).toBe(1);
  });

  it('caps catch-up after a long gap', () => {
    const s = new TickScheduler(100, 8);
    s.setSpeed(4);
    s.due(0);
    expect(s.due(60_000)).toBe(8);
    expect(s.due(60_100)).toBe(4);
  });
});
