/** Helpers for detecting / reconnecting in-progress deep-research runs. */

export type ActiveDeepResearchRun = {
  runId: string;
  sessionId: string;
  status: "running" | "awaiting_clarify" | string;
  phase: string;
  topic: string;
  updatedAt: string;
};

const PHASE_LABELS: Record<string, string> = {
  recon: "开题侦查",
  clarify: "澄清确认",
  plan: "规划路径",
  lanes: "并行检索",
  reflect: "复盘补搜",
  synthesize: "撰写报告",
  done: "已完成",
};

export function phaseLabelZh(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

export async function fetchActiveDeepResearchRuns(
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ActiveDeepResearchRun[]> {
  if (!sessionId.trim()) return [];
  try {
    const res = await fetchImpl(
      `/api/chat/deep-research/runs?sessionId=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { runs?: ActiveDeepResearchRun[] };
    };
    return Array.isArray(json.data?.runs) ? json.data!.runs! : [];
  } catch {
    return [];
  }
}

export function activeRunReconnectUrl(runId: string): string {
  return `/api/chat/deep-research/runs/${encodeURIComponent(runId)}/stream`;
}
