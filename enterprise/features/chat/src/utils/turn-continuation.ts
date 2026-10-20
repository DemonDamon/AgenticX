import type { ChatMessage } from "@agenticx/core-api";

/** A stopped report can continue only when the run saved a report checkpoint. */
export function isReportContinuationAvailable(message: ChatMessage | undefined): boolean {
  const research = message?.deep_research;
  if (!research || (research.status !== "failed" && research.status !== "cancelled")) return false;
  return research.events.some((event) => event.type === "report_resume_available");
}

/** The composer continues the latest ordinary answer in this session, never an older one. */
export function findContinuableResponse(
  messages: ChatMessage[],
  sessionId: string | null,
): ChatMessage | undefined {
  const last = [...messages].reverse().find((message) => message.session_id === sessionId);
  if (last?.role !== "assistant" || last.deep_research) return undefined;
  return last.interruption ? last : undefined;
}
