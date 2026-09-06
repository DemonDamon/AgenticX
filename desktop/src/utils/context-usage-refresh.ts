/** Same-session occupancy must refetch after retry trim / turn settle. */

export type ContextUsageRefreshInput = {
  sessionId: string;
  model: string;
  isStreaming: boolean;
  messageCount: number;
  lastMessageId: string;
  sessionInputTokens: number;
  sessionOutputTokens: number;
};

export function contextUsageMessageSignature(
  messages: ReadonlyArray<{ id?: string }>,
): { messageCount: number; lastMessageId: string } {
  const last = messages[messages.length - 1];
  return {
    messageCount: messages.length,
    lastMessageId: String(last?.id ?? ""),
  };
}

export function buildContextUsageRefreshKey(input: ContextUsageRefreshInput): string {
  const session = String(input.sessionId ?? "").trim();
  const model = String(input.model ?? "").trim();
  const messagePart = [
    String(input.messageCount ?? 0),
    String(input.lastMessageId ?? ""),
  ].join("\0");
  // Streaming still tracks message trim (retry/edit). Token ticks stay out of
  // the key so SSE token_usage does not refetch every chunk.
  if (input.isStreaming) {
    return `${session}\0${model}\0${messagePart}\0streaming`;
  }
  return [
    session,
    model,
    messagePart,
    String(input.sessionInputTokens ?? 0),
    String(input.sessionOutputTokens ?? 0),
  ].join("\0");
}

export function shouldFetchContextUsage(_isStreaming: boolean): boolean {
  return true;
}

/** Retry trim zeros pane tokens; keep the previous turn's occupancy off-screen. */
export function shouldDropCachedOccupancy(opts: {
  sessionInputTokens: number;
  cachedLedgerInput: number;
}): boolean {
  return opts.sessionInputTokens <= 0 && opts.cachedLedgerInput > 0;
}

/** Category share of the model window, matching the popup "已使用" percents. */
export function formatWindowPercent(value: number, maxTokens: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(maxTokens) || maxTokens <= 0 || value <= 0) {
    return "0%";
  }
  const pct = (value / maxTokens) * 100;
  if (pct < 0.05) return "0%";
  return `${Number(pct.toFixed(1))}%`;
}

export function formatOccupancyFullLabel(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return "0% 已占用";
  const rounded = Math.round(percent * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}% 已占用`;
}

export function formatCategoryTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.trunc(n));
  return `${(n / 1000).toFixed(1)}K`;
}

export function formatOccupancyTokenPair(used: number, max: number): string {
  return `${formatApproxTokens(used)} / ${formatWindowCap(max)}`;
}

function formatApproxTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "~0";
  if (n < 1000) return `~${Math.trunc(n)}`;
  return `~${(n / 1000).toFixed(1)}K`;
}

function formatWindowCap(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.trunc(n));
  const k = n / 1000;
  if (Math.abs(k - Math.round(k)) < 0.05) return `${Math.round(k)}K`;
  return `${k.toFixed(1)}K`;
}
