import { describe, expect, it } from 'vitest';
import { formatNumber } from './format';

describe('formatNumber', () => {
  it.each([
    [0, '0'], [999, '999'], [999.6, '1k'], [1000, '1k'], [1234, '1.2k'], [12_345, '12.3k'], [999_949, '999.9k'],
    [2_500_000, '2.5M'], [3_000_000_000, '3B'], [-1234, '-1.2k'], [12.4, '12'],
  ])('formats %s', (n, s) => expect(formatNumber(n)).toBe(s));
});
