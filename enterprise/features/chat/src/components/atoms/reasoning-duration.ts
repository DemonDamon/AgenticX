type ReasoningDurationEntry = {
  seconds: number;
  completed: boolean;
};

const durationCache = new Map<string, ReasoningDurationEntry>();
const MAX_CACHE_ENTRIES = 256;

export function getCachedReasoningDuration(key: string): ReasoningDurationEntry | undefined {
  if (!key) return undefined;
  return durationCache.get(key);
}

export function setCachedReasoningDuration(
  key: string,
  seconds: number,
  completed: boolean,
): void {
  if (!key) return;
  const normalized = Math.max(1, Math.round(seconds));
  const current = durationCache.get(key);
  if (current?.completed && !completed) return;
  durationCache.set(key, { seconds: normalized, completed });
  if (durationCache.size > MAX_CACHE_ENTRIES) {
    const oldest = durationCache.keys().next().value;
    if (oldest) durationCache.delete(oldest);
  }
}

export function measureReasoningSeconds(startedAt: number, finishedAt: number): number {
  return Math.max(1, Math.round((finishedAt - startedAt) / 1000));
}

export function formatReasoningTitle(options: {
  thinkingInProgress: boolean;
  elapsedSeconds: number;
  hasReliableDuration: boolean;
}): string {
  if (options.thinkingInProgress) {
    return options.hasReliableDuration
      ? `思考中（${options.elapsedSeconds} 秒）`
      : "思考中…";
  }
  return options.hasReliableDuration
    ? `思考了 ${options.elapsedSeconds} 秒`
    : "思考过程";
}
