import type { ChatMessage } from "@agenticx/core-api";

/** The composer continues the latest ordinary answer in this session, never an older one. */
export function findContinuableResponse(
  messages: ChatMessage[],
  sessionId: string | null,
): ChatMessage | undefined {
  const last = [...messages].reverse().find((message) => message.session_id === sessionId);
  if (last?.role !== "assistant" || last.deep_research) return undefined;
  return last.interruption ? last : undefined;
}
