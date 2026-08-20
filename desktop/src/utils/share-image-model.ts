import type { Message } from "../store";
import { parseReasoningContent } from "../components/messages/reasoning-parser";
import { messagePlainTextForClipboard } from "./markdown-copy-format";
import { isShowWidgetToolMessage, parseWidgetPayload } from "../components/messages/widget-preview";

export const SHARE_WIDGET_HINT = "（含图表，请以应用内为准）";

export type ShareImageGraphicSource =
  | { kind: "svg"; title?: string; code: string }
  | { kind: "mermaid"; title?: string; code: string }
  | { kind: "unsupported"; title?: string; hint: string };

export type ShareAssistantPart =
  | { kind: "md"; text: string }
  | { kind: "graphic"; source: ShareImageGraphicSource };

export type ShareImageTurn =
  | { kind: "user"; text: string }
  | { kind: "assistant"; parts: ShareAssistantPart[] }
  | { kind: "widget"; source: ShareImageGraphicSource };

const MERMAID_FENCE_RE = /```(?:mermaid|mmd)[^\n]*\n([\s\S]*?)```/gi;

function assistantShareText(message: Message): string {
  const raw = message.content || "";
  const parsed = parseReasoningContent(raw);
  const body = parsed.hasReasoningTag ? parsed.response : raw;
  return body.trim();
}

function optionalTitle(title: string | undefined): string | undefined {
  const trimmed = title?.trim();
  return trimmed ? trimmed : undefined;
}

export function splitAssistantShareParts(text: string): ShareAssistantPart[] {
  const parts: ShareAssistantPart[] = [];
  const re = new RegExp(MERMAID_FENCE_RE.source, "gi");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const before = text.slice(last, match.index).trim();
    if (before) parts.push({ kind: "md", text: before });
    const code = (match[1] ?? "").trim();
    if (code) parts.push({ kind: "graphic", source: { kind: "mermaid", code } });
    last = match.index + match[0].length;
  }
  const after = text.slice(last).trim();
  if (after) parts.push({ kind: "md", text: after });
  return parts;
}

export function widgetSourceFromMessage(message: Message): ShareImageGraphicSource {
  const payload = parseWidgetPayload(message.content || "");
  if (!payload) {
    return { kind: "unsupported", hint: SHARE_WIDGET_HINT };
  }
  if (payload.kind === "stock_chart") {
    return {
      kind: "unsupported",
      title: optionalTitle(payload.title),
      hint: SHARE_WIDGET_HINT,
    };
  }
  const title = optionalTitle(payload.title);
  if (payload.kind === "svg") {
    return { kind: "svg", title, code: payload.widgetCode };
  }
  if (payload.kind === "mermaid") {
    return { kind: "mermaid", title, code: payload.widgetCode };
  }
  return { kind: "unsupported", title, hint: SHARE_WIDGET_HINT };
}

/**
 * Flatten share-export messages into user bubbles, assistant markdown
 * (with in-place mermaid fences), and `show_widget` graphic turns.
 */
export function buildShareImageTurns(messages: Message[]): ShareImageTurn[] {
  const out: ShareImageTurn[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      if (isShowWidgetToolMessage(message)) {
        out.push({ kind: "widget", source: widgetSourceFromMessage(message) });
      }
      continue;
    }
    if (message.role === "user") {
      out.push({ kind: "user", text: messagePlainTextForClipboard(message) });
      continue;
    }
    if (message.role !== "assistant") continue;
    const text = assistantShareText(message);
    if (!text) continue;
    const parts = splitAssistantShareParts(text);
    if (parts.length === 0) continue;
    out.push({ kind: "assistant", parts });
  }

  return out;
}

export function formatShareCardDate(at: number = Date.now()): string {
  const d = new Date(at);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
