/** Last-turn prefix-cache hit percent, or null when that turn has no input. */
export function formatHitPercent(lastCached: number, lastInput: number): number | null {
  if (!Number.isFinite(lastInput) || lastInput <= 0) return null;
  const cached = Number.isFinite(lastCached) && lastCached > 0 ? lastCached : 0;
  return Math.round((cached / lastInput) * 1000) / 10;
}

export function pickUsageHit({
  lastCached,
  lastInput,
  sessionCached = 0,
  sessionInput = 0,
}: {
  lastCached: number;
  lastInput: number;
  sessionCached?: number;
  sessionInput?: number;
}): { hit: number | null; cached: number; input: number } {
  const lastHit = formatHitPercent(lastCached, lastInput);
  if (lastHit !== null) {
    return { hit: lastHit, cached: lastCached, input: lastInput };
  }
  const sessionHit = formatHitPercent(sessionCached, sessionInput);
  if (sessionHit !== null) {
    return { hit: sessionHit, cached: sessionCached, input: sessionInput };
  }
  return { hit: null, cached: 0, input: 0 };
}
