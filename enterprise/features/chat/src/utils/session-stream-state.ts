import type { ChatStoreState } from "../store";

export function isSessionStreaming(
  state: Pick<ChatStoreState, "streamStateBySessionId">,
  sessionId: string | null,
): boolean {
  if (!sessionId) return false;
  const s = state.streamStateBySessionId[sessionId];
  return s?.status === "sending" || s?.status === "streaming";
}

export function getSessionRequestId(
  state: Pick<ChatStoreState, "streamStateBySessionId">,
  sessionId: string | null,
): string | null {
  if (!sessionId) return null;
  return state.streamStateBySessionId[sessionId]?.activeRequestId ?? null;
}
