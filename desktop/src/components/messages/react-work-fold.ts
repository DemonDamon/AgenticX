import type { Message } from "../../store";
import { assistantVisibleBodyForUi } from "../../utils/assistant-output";
import type { GroupedChatRow } from "./group-tool-messages";

export type ProcessFoldRange = {
  /** 第一个 tool_group 的下标；没有工具时为 0（过程段为空）。 */
  start: number;
  /** 最后一个 tool_group 的下标 + 1；没有工具时为 0。 */
  end: number;
};

/**
 * 一个回复块里，哪一段属于「过程卡」（可折叠），哪一段是正文（永不折叠）。
 *
 * 过程段 = 第一个 tool_group ～ 最后一个 tool_group。它**前面**的行是模型开口就写的正文，
 * **后面**的行是最终回答，两头都不进折叠。
 *
 * 起点必须是第一个 tool_group 而不是 0。模型很常见地先把正文写完、再顺手调一次工具
 * （答完「延迟加载怎么触发」之后演示一下 tool_search），从 0 起折会把**正文本身**折进
 * 过程卡 —— 关掉「显示工具调用详情」时过程卡默认折叠，正文就整段消失了，用户只剩收尾一句。
 * 「不显示工具调用详情」承诺隐藏的是工具名称、参数和返回内容，不是助手正文。
 */
function visibleAssistantBody(message: Message): string {
  return assistantVisibleBodyForUi(String(message.content ?? "")).trim();
}

/** Empty-body row whose only payload is a persisted think segment. */
export function isReasoningOnlyAssistantMessage(message: Message): boolean {
  if (message.role !== "assistant") return false;
  if (visibleAssistantBody(message)) return false;
  return Boolean(String(message.reasoning ?? "").trim());
}

/**
 * Live turns sometimes append think-only rows after the terminal answer.
 * Disk order already has those thoughts among the tool calls; this puts the
 * live list back the same way so they fold into the process card instead of
 * painting under the answer and above the file cards.
 */
export function parkTrailingReasoningInProcess(rows: GroupedChatRow[]): GroupedChatRow[] {
  let term = -1;
  rows.forEach((row, index) => {
    if (row.kind !== "message" || row.message.role !== "assistant") return;
    if (!visibleAssistantBody(row.message)) return;
    term = index;
  });
  if (term < 0) return rows;
  const trailing: GroupedChatRow[] = [];
  const after: GroupedChatRow[] = [];
  for (let i = term + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.kind === "message" && isReasoningOnlyAssistantMessage(row.message)) trailing.push(row);
    else after.push(row);
  }
  if (trailing.length === 0) return rows;
  const prefix = rows.slice(0, term);
  let insertAt = prefix.length;
  for (let i = prefix.length - 1; i >= 0; i -= 1) {
    if (prefix[i].kind === "tool_group") {
      insertAt = i + 1;
      break;
    }
  }
  return [...prefix.slice(0, insertAt), ...trailing, ...prefix.slice(insertAt), rows[term], ...after];
}

export function resolveProcessFoldRange(rows: GroupedChatRow[]): ProcessFoldRange {
  let first = -1;
  let last = -1;
  rows.forEach((row, index) => {
    if (row.kind !== "tool_group") return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return { start: 0, end: 0 };
  let end = last + 1;
  while (end < rows.length) {
    const row = rows[end];
    if (row.kind === "message" && isReasoningOnlyAssistantMessage(row.message)) {
      end += 1;
      continue;
    }
    break;
  }
  return { start: first, end };
}
