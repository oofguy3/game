import { describe, expect, it } from 'vitest';
import { countUp } from './countUp';

describe('countUp', () => {
  it('starts at 0, ends exactly at the target and never goes past it', () => {
    expect(countUp(1234, 0)).toBe(0);
    expect(countUp(1234, 800)).toBe(1234);
    expect(countUp(1234, 5000)).toBe(1234);
    for (let t = 0; t <= 800; t += 50) expect(countUp(1234, t)).toBeLessThanOrEqual(1234);
  });

  it('is past halfway at half time (ease-out)', () => {
    expect(countUp(1000, 400)).toBeGreaterThan(500);
  });

  it('counts with the duration it is given', () => {
    expect(countUp(10, 100, 200)).toBeLessThan(10);
    expect(countUp(10, 200, 200)).toBe(10);
  });
});
