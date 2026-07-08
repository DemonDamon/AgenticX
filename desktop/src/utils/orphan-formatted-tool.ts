import type { Message } from "../store";

/** Streaming fallback rows from formatToolResultMessage (no structured metadata). */
const FORMATTED_TOOL_RESULT_RE =
  /^[✅⚠️❌🗣🔧]\s*(?:[\w.-]+\s+)?(?:结果|提示|状态快照):/u;

const EMPTY_FORMATTED_TOOL_RESULT_RE =
  /^[✅⚠️❌🗣🔧]\s*(?:[\w.-]+\s+)?(?:结果|提示|状态快照):\s*$/u;

const STREAM_TOOL_LABEL_ONLY_RE = /^结果\s*[：:]?\s*$/u;

export function isFormattedToolResultContent(content: string): boolean {
  return FORMATTED_TOOL_RESULT_RE.test(String(content ?? "").trim());
}

/** Orphan SSE fallback bubble: preformatted tool result text without tool_call_id. */
export function isOrphanFormattedToolResultMessage(
  message: Pick<Message, "role" | "content" | "toolCallId" | "toolGroupId">,
): boolean {
  if (message.role !== "tool") return false;
  if (message.toolCallId || message.toolGroupId) return false;
  const content = String(message.content ?? "").trim();
  if (!content) return false;
  return isFormattedToolResultContent(content);
}

export function isStreamToolLabelOnlyText(text: string): boolean {
  return STREAM_TOOL_LABEL_ONLY_RE.test(String(text ?? "").trim());
}

export function shouldSkipFormattedToolResultFallback(
  formattedContent: string,
  rawContent: string,
): boolean {
  const formatted = String(formattedContent ?? "").trim();
  const raw = String(rawContent ?? "").trim();
  if (!raw && EMPTY_FORMATTED_TOOL_RESULT_RE.test(formatted)) return true;
  if (isOrphanFormattedToolResultMessage({ role: "tool", content: formatted })) {
    // Meaningful fallback only when we have no structured row to merge into later.
    return raw.length < 4;
  }
  return false;
}
