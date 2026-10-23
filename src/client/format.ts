const UNITS: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

/** A short, readable count: 999 → "999", 1234 → "1.2k", 2_500_000 → "2.5M". */
export function formatNumber(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (Math.round(a) < 1000) return sign + String(Math.round(a));
  for (const [size, unit] of UNITS) {
    if (a >= size || (unit === 'k' && Math.round(a) >= 1000)) {
      const value = (Math.floor((a / size) * 10 + 0.5) / 10).toFixed(1).replace(/\.0$/, '');
      return sign + value + unit;
    }
  }
  return sign + String(Math.round(a));
}
