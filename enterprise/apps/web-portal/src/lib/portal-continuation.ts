import type { ChatMessage } from "@agenticx/core-api";
import { isReportContinuationAvailable } from "@agenticx/feature-chat";

/** Portal shows the continue card only for a stopped report that saved a checkpoint. */
export function findPortalReportContinuation(
  messages: ChatMessage[],
  sessionId: string | null,
): ChatMessage | undefined {
  return [...messages].reverse().find(
    (message) => message.session_id === sessionId && isReportContinuationAvailable(message),
  );
}
