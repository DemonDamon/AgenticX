import type { SubAgent, SubAgentStatus } from "../store";
import type { SubAgentRunRecord } from "../components/subagent/badge-vm";
import type { ActivityEntry } from "../components/subagent/run-drawer-api";

function normalizeStatus(raw: string | undefined): SubAgentStatus {
  const status = String(raw ?? "").trim() as SubAgentStatus;
  const allowed: SubAgentStatus[] = [
    "pending",
    "awaiting_confirm",
    "awaiting_input",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ];
  return allowed.includes(status) ? status : "completed";
}

function activityToEvents(entries: ActivityEntry[]) {
  return entries
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((entry) => ({
      id: `act-${entry.seq}`,
      type: entry.type,
      content: String(entry.detail ?? entry.title ?? "").trim() || entry.title,
      ts: entry.ts > 1_000_000_000_000 ? Math.floor(entry.ts) : Math.floor(entry.ts * 1000),
    }));
}

/** Rehydrate a persisted run record into the runtime `SubAgent` shape for Spawns / SubAgentCard. */
export function buildSubAgentFromRunRecord(
  record: SubAgentRunRecord,
  activities: ActivityEntry[],
  sessionId: string,
): SubAgent {
  const status = normalizeStatus(record.status);
  const resultSummary = String(record.result_summary ?? "").trim();
  const resultFile = String(record.result_file ?? "").trim() || undefined;
  const outputFiles = Array.isArray(record.output_files)
    ? record.output_files.map((item) => String(item)).filter(Boolean)
    : [];
  const currentAction =
    status === "completed"
      ? resultSummary
        ? "已完成（查看摘要）"
        : "已完成"
      : status === "failed"
        ? "执行异常"
        : status === "cancelled"
          ? "已中断"
          : status === "paused"
            ? resultSummary || "已暂停，可稍后继续"
            : "执行中";

  return {
    id: record.run_id,
    name: record.name,
    role: record.role,
    provider: record.provider || undefined,
    model: record.model || undefined,
    status,
    task: String(record.task ?? "").trim(),
    sessionId,
    progress: status === "completed" ? 1 : undefined,
    currentAction,
    resultSummary: resultSummary || undefined,
    resultFile,
    outputFiles,
    events: activityToEvents(activities),
  };
}
