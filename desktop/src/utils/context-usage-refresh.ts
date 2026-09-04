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
  if (input.isStreaming) {
    return `${session}\0${model}\0streaming`;
  }
  return [
    session,
    model,
    String(input.messageCount ?? 0),
    String(input.lastMessageId ?? ""),
    String(input.sessionInputTokens ?? 0),
    String(input.sessionOutputTokens ?? 0),
  ].join("\0");
}

export function shouldFetchContextUsage(isStreaming: boolean): boolean {
  return !isStreaming;
}
