/**
 * Helpers for the human-in-the-loop clarification flow (request_clarification).
 *
 * These mirror the backend `build_clarification_tool_result` so the frontend
 * can show an optimistic preview of the answer text that will be fed back to
 * the agent, and dedupe against the persisted chat_history row.
 */

export type ClarificationAnswer = {
  answerText: string;
  selectedOptions: string[];
};

export type PendingClarificationPayload = {
  requestId: string;
  prompt: string;
  options: string[];
  allowFreeText: boolean;
  agentId: string;
  sessionId: string;
  context?: Record<string, unknown> | undefined;
};

/**
 * Render the structured user answer as the same natural-language text the
 * backend will inject as the tool result. Used for optimistic UI preview
 * before the backend round-trips.
 */
export function buildClarificationAnswerText(answer: ClarificationAnswer): string {
  const text = (answer.answerText || "").trim();
  const selected = (answer.selectedOptions || [])
    .map((o) => (typeof o === "string" ? o.trim() : ""))
    .filter(Boolean);
  const parts: string[] = [];
  if (selected.length > 0) {
    parts.push(`用户选择：${selected.join("；")}`);
  }
  if (text) {
    parts.push(`自定义补充：${text}`);
  }
  if (parts.length === 0) {
    return "用户未提供具体内容（视为按你的默认方案推进）。";
  }
  return `${parts.join("；")}。`;
}

/**
 * Whether an incoming chat_history row (from disk or SSE) is a persisted
 * clarification prompt that should render as an inline card.
 */
export function isClarificationMessage(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const kind = (meta as Record<string, unknown>).kind;
  return kind === "clarification";
}

/**
 * Build a PendingClarificationPayload from a persisted metadata block (used
 * when reconstructing the inline card from disk on session switch / refresh).
 */
export function clarificationPayloadFromMeta(
  meta: Record<string, unknown>,
  agentId: string,
  sessionId: string,
): PendingClarificationPayload | null {
  if (!isClarificationMessage(meta)) return null;
  const m = meta as Record<string, unknown>;
  const requestId = String(m.request_id || m.id || "");
  if (!requestId) return null;
  const rawOptions = Array.isArray(m.options) ? m.options : [];
  return {
    requestId,
    prompt: String(m.prompt || ""),
    options: rawOptions.map((o) => String(o)).filter(Boolean),
    allowFreeText: m.allow_free_text !== false,
    agentId,
    sessionId,
    context: (m.context as Record<string, unknown> | undefined) ?? undefined,
  };
}
