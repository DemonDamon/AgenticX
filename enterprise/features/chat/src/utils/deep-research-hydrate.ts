/** Rehydrate deep-research workbench from run-store when chat history metadata is missing. */

import type { ChatMessage, ChatMessageDeepResearch, DeepResearchEvent } from "@agenticx/core-api";

export type HydrateDeepResearchRun = {
  runId: string;
  sessionId: string;
  status: ChatMessageDeepResearch["status"] | string;
  phase: string;
  topic: string;
  updatedAt: string;
  events: DeepResearchEvent[];
  artifactIds?: string[];
};

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function normalizeStatus(raw: string): ChatMessageDeepResearch["status"] {
  if (raw === "running" || raw === "awaiting_clarify") return raw;
  if (raw === "failed" || raw === "cancelled") return raw;
  return "completed";
}

/**
 * Attach run-store events onto the last assistant message that lacks a workbench,
 * so refresh / session-switch still shows 冷启动 / 澄清 / 调研车道.
 */
export function mergeDeepResearchHydrate(
  messages: ChatMessage[],
  latest: HydrateDeepResearchRun | null | undefined,
): ChatMessage[] {
  if (!latest?.runId || !Array.isArray(latest.events) || latest.events.length === 0) {
    return messages;
  }
  const hasWorkbench = messages.some(
    (m) => m.role === "assistant" && (m.deep_research?.events?.length ?? 0) > 0,
  );
  if (hasWorkbench) return messages;

  let targetIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "assistant") {
      targetIndex = i;
      break;
    }
  }
  if (targetIndex < 0) return messages;

  const target = messages[targetIndex]!;
  // Don't overwrite a message that already belongs to a different run.
  if (target.deep_research?.runId && target.deep_research.runId !== latest.runId) {
    return messages;
  }

  const status = normalizeStatus(String(latest.status));
  const artifactIds =
    latest.artifactIds?.length
      ? latest.artifactIds
      : latest.events
          .filter((e): e is Extract<DeepResearchEvent, { type: "artifact" }> => e.type === "artifact")
          .map((e) => e.id)
          .filter((id): id is string => typeof id === "string")
          .slice(0, 40);

  const deep_research: ChatMessageDeepResearch = {
    runId: latest.runId,
    status,
    events: latest.events.slice(-200),
    ...(artifactIds.length > 0 ? { artifactIds } : {}),
  };

  const hasPhaseDone = latest.events.some((e) => e.type === "phase" && e.phase === "done");
  const hasFinalReport = latest.events.some(
    (e) =>
      e.type === "artifact" &&
      (e.kind === "report" ||
        (typeof e.path === "string" && e.path.includes("final-report"))),
  );
  // Handler may have died after delivering artifacts but before finish().
  if (
    deep_research.status === "running" &&
    (latest.phase === "done" || hasPhaseDone || hasFinalReport)
  ) {
    deep_research.status = "completed";
  } else if (!TERMINAL.has(deep_research.status) && deep_research.status !== "awaiting_clarify") {
    // Keep running / awaiting_clarify; coerce unknown → completed only when terminal cues exist.
    if (hasPhaseDone || hasFinalReport) deep_research.status = "completed";
  }

  const next = messages.slice();
  next[targetIndex] = { ...target, deep_research };
  return next;
}

export async function fetchLatestDeepResearchForHydrate(
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HydrateDeepResearchRun | null> {
  if (!sessionId.trim()) return null;
  try {
    const res = await fetchImpl(
      `/api/chat/deep-research/runs?sessionId=${encodeURIComponent(sessionId)}&hydrate=1`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { latest?: HydrateDeepResearchRun | null };
    };
    return json.data?.latest ?? null;
  } catch {
    return null;
  }
}

export async function hydrateMessagesDeepResearch(
  sessionId: string,
  messages: ChatMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<ChatMessage[]> {
  if (messages.some((m) => (m.deep_research?.events?.length ?? 0) > 0)) {
    return messages;
  }
  const latest = await fetchLatestDeepResearchForHydrate(sessionId, fetchImpl);
  return mergeDeepResearchHydrate(messages, latest);
}
