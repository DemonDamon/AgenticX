import type { SubAgent, SubAgentStatus } from "../store";
import { useAppStore } from "../store";
import type { SubAgentRunRecord } from "../components/subagent/badge-vm";
import type { ActivityEntry } from "../components/subagent/run-drawer-api";
import { fetchSubAgentClusters } from "../components/subagent/run-drawer-api";
import { isSubAgentLiveStatus } from "./stream-overlay-policy";

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

/**
 * Cold-start: load persisted `subagent_runs` clusters for a session into the
 * Zustand `subAgents` list so WorkPanel「子智能体」survives Desktop / agx restart.
 * Never clobber an in-memory live (running / awaiting_*) agent.
 */
export async function hydrateSessionSubAgentsFromDisk(
  apiBase: string,
  apiToken: string,
  sessionId: string,
): Promise<{ ok: boolean; hydrated: number; error?: string }> {
  const sid = String(sessionId || "").trim();
  const base = String(apiBase || "").trim();
  const token = String(apiToken || "").trim();
  if (!sid || !base || !token) {
    return { ok: false, hydrated: 0, error: "missing session or api credentials" };
  }

  const resp = await fetchSubAgentClusters(base, token, sid);
  if (!resp.ok || !Array.isArray(resp.clusters)) {
    return {
      ok: false,
      hydrated: 0,
      error: resp.error || resp.detail || "subagent clusters fetch failed",
    };
  }

  let hydrated = 0;
  for (const cluster of resp.clusters) {
    const members = Array.isArray(cluster.members) ? cluster.members : [];
    for (const member of members) {
      const rid = String(member.run_id ?? "").trim();
      if (!rid) continue;
      const store = useAppStore.getState();
      const existing = store.subAgents.find((item) => item.id === rid);
      if (existing && isSubAgentLiveStatus(existing.status)) {
        continue;
      }
      const built = buildSubAgentFromRunRecord(member, [], sid);
      if (existing) {
        store.updateSubAgent(rid, {
          name: built.name,
          role: built.role,
          provider: built.provider,
          model: built.model,
          status: built.status,
          currentAction: built.currentAction,
          progress: built.progress,
          resultSummary: built.resultSummary,
          resultFile: built.resultFile,
          outputFiles: built.outputFiles,
          sessionId: sid,
        });
      } else {
        store.addSubAgent({
          id: rid,
          name: built.name,
          role: built.role,
          task: "",
          provider: built.provider,
          model: built.model,
          sessionId: sid,
        });
        store.updateSubAgent(rid, {
          status: built.status,
          currentAction: built.currentAction,
          progress: built.progress,
          resultSummary: built.resultSummary,
          resultFile: built.resultFile,
          outputFiles: built.outputFiles,
        });
      }
      hydrated += 1;
    }
  }
  return { ok: true, hydrated };
}
