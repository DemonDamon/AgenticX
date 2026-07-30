/**
 * Drop empty assistant rows before forwarding chat completions upstream.
 *
 * Portal UI optimistically appends `assistant` with `content: ""` while streaming.
 * Moonshot/Kimi (and similar) reject those with:
 *   Invalid request: the message at position N with role 'assistant' must not be empty
 */

type CompletionMessage = {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
  [key: string]: unknown;
};

function contentIsEmpty(content: unknown): boolean {
  if (content == null) return true;
  if (typeof content === "string") return !content.trim();
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const row = block as { type?: unknown; text?: unknown };
      if (row.type === "text" && typeof row.text === "string" && row.text.trim()) {
        return false;
      }
    }
    return true;
  }
  return !String(content).trim();
}

/** Keep assistant+tool_calls rows even when content is empty; drop orphan empty assistants. */
export function stripEmptyAssistantMessages<T extends CompletionMessage>(messages: T[]): T[] {
  return messages.filter((msg) => {
    if (String(msg.role ?? "").trim().toLowerCase() !== "assistant") return true;
    if (!contentIsEmpty(msg.content)) return true;
    const toolCalls = msg.tool_calls;
    return Array.isArray(toolCalls) && toolCalls.length > 0;
  });
}
