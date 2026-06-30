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

/** Fallback when no stream timer or persisted seconds exist (≈400 chars / sec, min 1). */
export function estimateReasoningSeconds(text: string): number {
  const len = String(text ?? "").trim().length;
  if (len <= 0) return 1;
  return Math.max(1, Math.min(600, Math.round(len / 400)));
}

/** Persisted → in-memory cache → length estimate (non-streaming display). */
export function resolvePersistedReasoningSeconds(
  reasoningText: string,
  persistedSeconds?: number,
): number | undefined {
  if (typeof persistedSeconds === "number" && persistedSeconds >= 1) {
    return persistedSeconds;
  }
  const trimmed = reasoningText.trim();
  if (!trimmed) return undefined;
  const cached = getCachedReasoningDuration(trimmed);
  if (cached !== undefined) return cached;
  return estimateReasoningSeconds(trimmed);
}
