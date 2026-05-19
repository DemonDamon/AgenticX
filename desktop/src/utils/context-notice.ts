import type { ContextNoticeKind, Message } from "../store";

export type { ContextNoticeKind };

const LEGACY_PREFIX_RE = /^(?:⚠️|🗜️|❌)\s*/u;

export function stripLegacyNoticePrefix(content: string): string {
  return String(content ?? "").trim().replace(LEGACY_PREFIX_RE, "").trim();
}

function detectKindFromText(text: string): ContextNoticeKind | null {
  if (text.includes("但仍超限") || text.includes("上下文接近上限，建议收口")) return "budget_compress";
  if (text.includes("上下文 token 接近上限")) return "budget_compress";
  if (text.includes("自动上下文压缩已暂停")) return "compactor_cb";
  if (text.includes("上下文接近上限，已压缩")) return "compaction_reactive";
  if (text.includes("Token 接近上限，已自动压缩")) return "compaction_reactive";
  if (text.includes("已压缩") && text.includes("任务继续")) return "compaction_proactive";
  if (text.includes("已自动压缩") && text.includes("历史")) return "compaction_proactive";
  return null;
}

export function buildCompactionNoticeText(count: number, reactive: boolean): string {
  if (reactive) {
    return `上下文接近上限，已压缩 ${count} 条历史，任务继续。`;
  }
  return `已压缩 ${count} 条较早历史，任务继续。`;
}

/** Context/token budget notices should render as a flat inline line, not ToolCallCard. */
export function parseContextNotice(
  message: Pick<Message, "role" | "content" | "toolName" | "toolCallId" | "noticeKind">
): { kind: ContextNoticeKind; text: string } | null {
  if (message.role !== "tool") return null;
  if ((message.toolName ?? "").trim()) return null;
  if ((message.toolCallId ?? "").trim()) return null;

  const text = stripLegacyNoticePrefix(message.content);
  if (!text) return null;

  const kind = message.noticeKind ?? detectKindFromText(text);
  if (!kind) return null;

  return { kind, text };
}

export function isContextNoticeMessage(
  message: Pick<Message, "role" | "content" | "toolName" | "toolCallId" | "noticeKind">
): boolean {
  return parseContextNotice(message) !== null;
}
