/**
 * Strip reasoning chains and prior-turn citation indices from assistant history
 * before the payload is sent upstream.
 *
 * Trade-off (intentional): after stripping historical [N], the model cannot answer
 * "你刚才第 3 条引用的是什么". Cross-turn indices are already unreliable (each turn
 * renumbers from 1), and keeping them causes false self-corrections (D2).
 * DB persistence and the sources panel are unchanged — only the upstream copy is cleaned.
 */

type ChatMessage = {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
};

const THINK_OPEN = "<" + "think" + ">";
const THINK_CLOSE = "<" + "/" + "think" + ">";
const REDACTED_OPEN = "<" + "think" + ">";
const REDACTED_CLOSE = "<" + "/" + "think" + ">";

function stripThinkBlocks(text: string): string {
  let out = text;
  const pairs: Array<[string, string]> = [
    [THINK_OPEN, THINK_CLOSE],
    // Portal may normalize provider tags to a redacted form; keep a second pass
    // that is identical today but stays explicit for future divergence.
    [REDACTED_OPEN, REDACTED_CLOSE],
  ];
  for (const [open, close] of pairs) {
    const openLower = open.toLowerCase();
    const closeLower = close.toLowerCase();
    while (true) {
      const lower = out.toLowerCase();
      const start = lower.indexOf(openLower);
      if (start < 0) break;
      const end = lower.indexOf(closeLower, start + open.length);
      if (end < 0) {
        out = out.slice(0, start);
        break;
      }
      out = out.slice(0, start) + out.slice(end + close.length);
    }
  }
  return out;
}

function sanitizeAssistantContent(content: string): string {
  let text = stripThinkBlocks(content);
  text = text.replace(/\[(\d{1,3})\]/g, "");
  text = text.replace(/[ \t]{2,}/g, " ");
  // Collapse space runs created inside a line; keep newlines for structure.
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
  return text.trim();
}

/** 上行前清洗历史 assistant 消息：推理链与旧编号都不该进模型上下文。 */
export function sanitizeHistoryForUpstream(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") {
      out.push(msg);
      continue;
    }
    const raw = typeof msg.content === "string" ? msg.content : "";
    const cleaned = sanitizeAssistantContent(raw);
    if (!cleaned) continue;
    out.push({ ...msg, content: cleaned });
  }
  return out;
}
