/** Persist reasoning elapsed seconds across stream → committed remounts. */
const cache = new Map<string, number>();
const MAX_CACHE = 256;

export function reasoningDurationKey(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `${trimmed.length}\0${trimmed.slice(0, 160)}`;
}

export function getCachedReasoningDuration(text: string): number | undefined {
  const key = reasoningDurationKey(text);
  if (!key) return undefined;
  return cache.get(key);
}

export function setCachedReasoningDuration(text: string, seconds: number): void {
  const key = reasoningDurationKey(text);
  if (!key) return;
  const normalized = Math.max(1, Math.round(seconds));
  cache.set(key, normalized);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

export function formatReasoningTitle(options: {
  streaming: boolean;
  elapsedSeconds: number;
  hasReliableDuration: boolean;
}): string {
  if (options.streaming) {
    if (options.hasReliableDuration && options.elapsedSeconds >= 1) {
      return `思考中（${options.elapsedSeconds} 秒）`;
    }
    return "思考中…";
  }
  if (options.hasReliableDuration) {
    return `思考了 ${options.elapsedSeconds} 秒`;
  }
  return "思考过程";
}

export function measureReasoningSeconds(startedAt: number, finishedAt: number): number {
  return Math.max(1, Math.round((finishedAt - startedAt) / 1000));
}
