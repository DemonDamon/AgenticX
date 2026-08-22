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
export function resolveProcessFoldRange(rows: GroupedChatRow[]): ProcessFoldRange {
  let first = -1;
  let last = -1;
  rows.forEach((row, index) => {
    if (row.kind !== "tool_group") return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return { start: 0, end: 0 };
  return { start: first, end: last + 1 };
}
