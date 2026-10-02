const SUBAGENT_SUMMARY_PREFIX = "子智能体汇总:";

/** 后端把子智能体原始产出以 assistant 行写入历史供模型使用；用户侧不应直接看到这种机械输出。 */
export function isSubAgentSummaryDump(message: { role?: string; content?: unknown }): boolean {
  if (message.role !== "assistant") return false;
  return typeof message.content === "string" && message.content.trimStart().startsWith(SUBAGENT_SUMMARY_PREFIX);
}
