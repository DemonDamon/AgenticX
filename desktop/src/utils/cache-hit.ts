/** Last-turn prefix-cache hit percent, or null when that turn has no input. */
export function formatHitPercent(lastCached: number, lastInput: number): number | null {
  if (!Number.isFinite(lastInput) || lastInput <= 0) return null;
  const cached = Number.isFinite(lastCached) && lastCached > 0 ? lastCached : 0;
  return Math.round((cached / lastInput) * 1000) / 10;
}
