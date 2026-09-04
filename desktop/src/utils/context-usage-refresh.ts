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
