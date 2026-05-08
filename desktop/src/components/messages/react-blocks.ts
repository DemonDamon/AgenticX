import type { Message } from "../../store";
import { parseReasoningContent } from "./reasoning-parser";

export type ReActBlockModel = {
  workMessages: Message[];
  /** When set, render as a full second assistant row with avatar (Manus-style). */
  finalAssistant: Message | null;
};

export type TopLevelChatRow =
  | { kind: "user"; message: Message }
  | { kind: "react"; block: ReActBlockModel };

/**
 * Split messages into user rows and ReAct blocks (assistant + tool between user boundaries).
 */
export function expandMessagesToTopLevelRows(messages: Message[]): TopLevelChatRow[] {
  const out: TopLevelChatRow[] = [];
  let buf: Message[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    out.push({ kind: "react", block: splitReActBlock(buf) });
    buf = [];
  };
  for (const m of messages) {
    if (m.role === "user") {
      flush();
      out.push({ kind: "user", message: m });
    } else {
      buf.push(m);
    }
  }
  flush();
  return out;
}

/**
 * Optionally peel the last assistant message into `finalAssistant` when it qualifies (FR-0).
 */
export function splitReActBlock(block: Message[]): ReActBlockModel {
  // 始终保持在一个 ReAct 块中，不再分离 finalAssistant，避免流式输出过程中的闪烁和割裂感
  return { workMessages: block, finalAssistant: null };
}
