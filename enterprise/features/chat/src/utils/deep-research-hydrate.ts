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

function isPlaceholderRunId(runId: string | undefined): boolean {
  return runId === "pending" || runId === "unknown";
}

function buildWorkbenchFromLatest(latest: HydrateDeepResearchRun): ChatMessageDeepResearch {
  const status = normalizeStatus(String(latest.status));
  const artifactIds =
    latest.artifactIds?.length
      ? latest.artifactIds
      : latest.events
          .filter((e): e is Extract<DeepResearchEvent, { type: "artifact" }> => e.type === "artifact")
          .map((e) => e.id)
          .filter((id): id is string => typeof id === "string")
          .slice(0, 40);

  const deepResearch: ChatMessageDeepResearch = {
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
  if (
    deepResearch.status === "running" &&
    (latest.phase === "done" || hasPhaseDone || hasFinalReport)
  ) {
    deepResearch.status = "completed";
  } else if (!TERMINAL.has(deepResearch.status) && deepResearch.status !== "awaiting_clarify") {
    if (hasPhaseDone || hasFinalReport) deepResearch.status = "completed";
  }

  return deepResearch;
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

  const workbench = buildWorkbenchFromLatest(latest);

  // Prefer the bubble that already belongs to this run. A live placeholder uses
  // runId=pending until the first persisted run event provides the real id.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "assistant" || !message.deep_research) continue;
    const runId = message.deep_research.runId;
    if (runId !== latest.runId && !isPlaceholderRunId(runId)) continue;
    const next = messages.slice();
    next[i] = {
      ...message,
      deep_research: {
        ...workbench,
        ...(message.deep_research.clarifyAnswers
          ? { clarifyAnswers: message.deep_research.clarifyAnswers }
          : {}),
      },
    };
    return next;
  }

  const hasWorkbench = messages.some(
    (m) => m.role === "assistant" && (m.deep_research?.events?.length ?? 0) > 0,
  );
  if (hasWorkbench) return messages;

  const topic = latest.topic.trim();
  let matchingUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user" && topic && m.content.trim() === topic) {
      matchingUserIndex = i;
      break;
    }
  }

  // If the user half was durably staged before the long stream, only the
  // assistant shell is missing after refresh. Recreate it directly after the
  // matching user instead of attaching the workbench to an older answer.
  if (matchingUserIndex >= 0) {
    for (let i = matchingUserIndex + 1; i < messages.length; i += 1) {
      const message = messages[i];
      if (!message || message.role === "user") break;
      if (message.role !== "assistant") continue;
      const next = messages.slice();
      next[i] = { ...message, deep_research: workbench };
      return next;
    }

    const user = messages[matchingUserIndex]!;
    const createdAtMs = Date.parse(user.created_at);
    const syntheticAssistant: ChatMessage = {
      id: `dr-assistant-${latest.runId}`,
      session_id: latest.sessionId,
      tenant_id: user.tenant_id,
      user_id: user.user_id,
      role: "assistant",
      content: "",
      created_at: Number.isFinite(createdAtMs)
        ? new Date(createdAtMs + 1).toISOString()
        : latest.updatedAt,
      deep_research: workbench,
    };
    return [
      ...messages.slice(0, matchingUserIndex + 1),
      syntheticAssistant,
      ...messages.slice(matchingUserIndex + 1),
    ];
  }

  // Completed runs can have an assistant body in history while its metadata was
  // lost. Preserve the legacy repair only when the last message is that answer.
  const lastIndex = messages.length - 1;
  if (lastIndex >= 0 && messages[lastIndex]?.role === "assistant") {
    const next = messages.slice();
    next[lastIndex] = { ...messages[lastIndex]!, deep_research: workbench };
    return next;
  }

  // Older clients did not durably stage either half of an in-flight turn. Keep
  // the run visible by synthesizing a deterministic shell from run-store data.
  const tenantId = messages[0]?.tenant_id ?? "tenant";
  const userId = messages[0]?.user_id ?? "user";
  const syntheticUser: ChatMessage | null = topic
    ? {
        id: `dr-user-${latest.runId}`,
        session_id: latest.sessionId,
        tenant_id: tenantId,
        user_id: userId,
        role: "user",
        content: topic,
        created_at: latest.updatedAt,
      }
    : null;
  const syntheticAssistant: ChatMessage = {
    id: `dr-assistant-${latest.runId}`,
    session_id: latest.sessionId,
    tenant_id: tenantId,
    user_id: userId,
    role: "assistant",
    content: "",
    created_at: latest.updatedAt,
    deep_research: workbench,
  };
  return [...messages, ...(syntheticUser ? [syntheticUser] : []), syntheticAssistant];
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
  // Always consult run-store: chat history may contain only a stale/pending
  // workbench when the browser refreshed before the stream's final append.
  const latest = await fetchLatestDeepResearchForHydrate(sessionId, fetchImpl);
  return mergeDeepResearchHydrate(messages, latest);
}
