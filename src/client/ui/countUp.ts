/** A number counting up to `target` over `durationMs` (easing out), `elapsedMs` in: floored, exactly `target` at the end. */
export function countUp(target: number, elapsedMs: number, durationMs = 800): number {
  if (elapsedMs >= durationMs) return target;
  const p = Math.max(0, elapsedMs) / durationMs;
  return Math.min(target, Math.floor(target * (1 - (1 - p) ** 3)));
}
