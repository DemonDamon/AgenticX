import type { Message } from "../store";
import { parseReasoningContent } from "../components/messages/reasoning-parser";
import { messagePlainTextForClipboard } from "./markdown-copy-format";
import { isShowWidgetToolMessage } from "../components/messages/widget-preview";

export const SHARE_WIDGET_HINT = "（含图表，请以应用内为准）";

export type ShareImageTurn =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; hasWidgetHint?: boolean };

function assistantShareText(message: Message): string {
  const raw = message.content || "";
  const parsed = parseReasoningContent(raw);
  const body = parsed.hasReasoningTag ? parsed.response : raw;
  return body.trim();
}

/**
 * Flatten share-export messages into user bubbles + assistant markdown rows.
 * `show_widget` tools are not rasterized; a muted hint is attached to the
 * nearest assistant turn.
 */
export function buildShareImageTurns(messages: Message[]): ShareImageTurn[] {
  const out: ShareImageTurn[] = [];
  let pendingWidget = false;

  const attachWidgetHint = () => {
    for (let i = out.length - 1; i >= 0; i -= 1) {
      const row = out[i];
      if (row?.kind === "assistant") {
        row.hasWidgetHint = true;
        return true;
      }
    }
    return false;
  };

  for (const message of messages) {
    if (message.role === "tool") {
      if (isShowWidgetToolMessage(message)) pendingWidget = true;
      continue;
    }
    if (message.role === "user") {
      out.push({ kind: "user", text: messagePlainTextForClipboard(message) });
      continue;
    }
    if (message.role !== "assistant") continue;
    const text = assistantShareText(message);
    if (!text && !pendingWidget) continue;
    const turn: ShareImageTurn = { kind: "assistant", text };
    if (pendingWidget) {
      turn.hasWidgetHint = true;
      pendingWidget = false;
    }
    out.push(turn);
  }

  if (pendingWidget) attachWidgetHint();
  return out;
}

export function formatShareCardDate(at: number = Date.now()): string {
  const d = new Date(at);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
