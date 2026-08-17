/** Rehydrate deep-research workbench from run-store when chat history metadata is missing. */

import type { ChatMessage, ChatMessageDeepResearch, DeepResearchEvent } from "@agenticx/core-api";
import { freezePlanChatSourceDeepResearch } from "./deep-research-plan-chat-composer";

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
const PLAN_CHAT_USER_PREFIX = "你：";

function normalizeStatus(raw: string): ChatMessageDeepResearch["status"] {
  if (raw === "running" || raw === "awaiting_clarify") return raw;
  if (raw === "failed" || raw === "cancelled") return raw;
  return "completed";
}

/** Derive the latest interaction profile / plan snapshot from persisted events. */
export function deriveDeepResearchSnapshot(events: DeepResearchEvent[]): {
  profile?: ChatMessageDeepResearch["profile"];
  plan?: ChatMessageDeepResearch["plan"];
  planVersion?: number;
  assumptions?: string[];
} {
  let profile: ChatMessageDeepResearch["profile"];
  let plan: ChatMessageDeepResearch["plan"];
  let planVersion: number | undefined;
  for (const event of events) {
    if (event.type === "research_profile") {
      profile = {
        researchDepth: event.researchDepth,
        clarifyMode: event.clarifyMode,
        clarifyBudget: event.clarifyBudget,
        planVisibility: event.planVisibility,
        assumptions: event.assumptions,
      };
    } else if (event.type === "research_plan") {
      plan = event.plan;
      planVersion = event.version;
    }
  }
  return {
    ...(profile ? { profile } : {}),
    ...(plan ? { plan } : {}),
    ...(planVersion ? { planVersion } : {}),
    ...(profile?.assumptions?.length ? { assumptions: profile.assumptions } : {}),
  };
}

/** plan_chat 多轮改计划时，事件里会落 `你：…` narrative。 */
export function extractPlanChatUserReplies(events: DeepResearchEvent[]): string[] {
  const out: string[] = [];
  for (const event of events) {
    if (event.type !== "narrative" || typeof event.text !== "string") continue;
    if (!event.text.startsWith(PLAN_CHAT_USER_PREFIX)) continue;
    const content = event.text.slice(PLAN_CHAT_USER_PREFIX.length).trim();
    if (content) out.push(content);
  }
  return out;
}

function isPlanChatHydrateCandidate(events: DeepResearchEvent[]): boolean {
  if (extractPlanChatUserReplies(events).length > 0) return true;
  for (const event of events) {
    if (event.type === "research_profile" && event.planVisibility === "chat_editable") {
      return true;
    }
    if (event.type === "research_plan" && event.action === "updated") {
      return true;
    }
  }
  return false;
}

/** 截取首轮改计划之前的事件，供历史方案卡冻结展示。 */
export function sliceEventsThroughPlanVersion(
  events: DeepResearchEvent[],
  version: number,
): DeepResearchEvent[] {
  const out: DeepResearchEvent[] = [];
  let sawTargetPlan = false;
  for (const event of events) {
    if (event.type === "research_plan" && event.version > version) break;
    if (
      sawTargetPlan &&
      event.type === "narrative" &&
      typeof event.text === "string" &&
      event.text.startsWith(PLAN_CHAT_USER_PREFIX)
    ) {
      break;
    }
    if (sawTargetPlan && event.type === "research_plan") break;
    out.push(event);
    if (event.type === "research_plan" && event.version === version) {
      sawTargetPlan = true;
    }
  }
  return out;
}

function firstPlanVersionBeforeReplies(events: DeepResearchEvent[]): number {
  let version = 1;
  for (const event of events) {
    if (
      event.type === "narrative" &&
      typeof event.text === "string" &&
      event.text.startsWith(PLAN_CHAT_USER_PREFIX)
    ) {
      break;
    }
    if (event.type === "research_plan") {
      version = event.version;
    }
  }
  return Math.max(1, version);
}

function isPlaceholderRunId(runId: string | undefined): boolean {
  return runId === "pending" || runId === "unknown";
}

function matchesSameRun(
  message: ChatMessage,
  runId: string,
): boolean {
  const rid = message.deep_research?.runId;
  return rid === runId || isPlaceholderRunId(rid);
}

function buildWorkbenchFromLatest(latest: HydrateDeepResearchRun): ChatMessageDeepResearch {
  const status = normalizeStatus(String(latest.status));
  const artifactIds =
    latest.artifactIds?.length
      ? latest.artifactIds
      : latest.events
          .filter(
            (e): e is Extract<DeepResearchEvent, { type: "artifact" }> => e.type === "artifact",
          )
          .map((e) => e.id)
          .filter((id): id is string => typeof id === "string")
          .slice(0, 40);
  const snapshot = deriveDeepResearchSnapshot(latest.events);
  const deep_research: ChatMessageDeepResearch = {
    runId: latest.runId,
    status,
    events: latest.events.slice(-200),
    ...(artifactIds.length > 0 ? { artifactIds } : {}),
    ...snapshot,
  };
  const hasPhaseDone = latest.events.some((e) => e.type === "phase" && e.phase === "done");
  const hasFinalReport = latest.events.some(
    (e) =>
      e.type === "artifact" &&
      (e.kind === "report" ||
        (typeof e.path === "string" && e.path.includes("final-report"))),
  );
  if (
    deep_research.status === "running" &&
    (latest.phase === "done" || hasPhaseDone || hasFinalReport)
  ) {
    deep_research.status = "completed";
  } else if (!TERMINAL.has(deep_research.status) && deep_research.status !== "awaiting_clarify") {
    if (hasPhaseDone || hasFinalReport) deep_research.status = "completed";
  }
  return deep_research;
}

function findLastSameRunAssistantIndex(messages: ChatMessage[], runId: string): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    if (matchesSameRun(message, runId)) return i;
  }
  return -1;
}

/**
 * 计划对齐刷新修复：改计划用户话若夹在「首轮方案卡」与「执行/终稿」之间，
 * 不得把 run-store 全量工作台叠回第一张卡（否则刷新后用户话会掉到报告后面）。
 */
export function repairPlanChatHydrateTimeline(
  messages: ChatMessage[],
  latest: HydrateDeepResearchRun,
  workbench: ChatMessageDeepResearch,
): ChatMessage[] | null {
  if (!isPlanChatHydrateCandidate(latest.events)) return null;
  const replies = extractPlanChatUserReplies(latest.events);
  if (replies.length === 0) return null;

  const topic = latest.topic.trim();
  let revisionIndices: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    const text = message.content.trim();
    if (replies.some((reply) => reply === text)) {
      revisionIndices.push(i);
    }
  }

  const sameRunIndices: number[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    if (message.deep_research && matchesSameRun(message, latest.runId)) {
      sameRunIndices.push(i);
    }
  }

  if (sameRunIndices.length > 0) {
    const firstRunIndex = sameRunIndices[0]!;
    revisionIndices = revisionIndices.filter((index) => index > firstRunIndex);
  }

  // 无 `你：` 对得上时：首张同 run 方案卡之后、且不等于开题 topic 的用户话，视为改计划轮次。
  if (revisionIndices.length === 0 && sameRunIndices.length > 0) {
    const firstDrIdx = sameRunIndices[0]!;
    for (let i = firstDrIdx + 1; i < messages.length; i += 1) {
      const message = messages[i];
      if (!message || message.role !== "user") continue;
      const text = message.content.trim();
      if (!text || (topic && text === topic)) continue;
      revisionIndices.push(i);
    }
  }
  if (revisionIndices.length === 0) return null;

  const lastRevisionIdx = revisionIndices[revisionIndices.length - 1]!;
  if (sameRunIndices.length === 0) {
    for (let i = lastRevisionIdx - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "assistant") {
        sameRunIndices.push(i);
        break;
      }
    }
  }
  if (sameRunIndices.length === 0) return null;

  const earlyIndices = sameRunIndices.filter((index) => index < lastRevisionIdx);
  const lateIndices = sameRunIndices.filter((index) => index > lastRevisionIdx);
  if (earlyIndices.length === 0 && lateIndices.length === 0) return null;

  // 已正确：执行气泡在改计划话之后，且早期卡没有全量事件。
  if (lateIndices.length > 0 && earlyIndices.length > 0) {
    const lateIdx = lateIndices[lateIndices.length - 1]!;
    const lateEvents = messages[lateIdx]?.deep_research?.events?.length ?? 0;
    const earlyBloated = earlyIndices.some((index) => {
      const count = messages[index]?.deep_research?.events?.length ?? 0;
      return count >= latest.events.length;
    });
    if (!earlyBloated && lateEvents >= latest.events.length) {
      return null;
    }
  }

  const keepVersion = firstPlanVersionBeforeReplies(latest.events);
  const historicalEvents = sliceEventsThroughPlanVersion(latest.events, keepVersion);
  const next = messages.slice();
  let movedContent = "";
  const shouldMoveReportContent =
    workbench.status === "completed" ||
    workbench.status === "failed" ||
    workbench.events.some((event) => event.type === "artifact") ||
    workbench.events.some(
      (event) =>
        event.type === "lane_started" &&
        event.laneId !== "recon-cold-start" &&
        !String(event.laneId ?? "").startsWith("recon-"),
    );

  for (const index of earlyIndices) {
    const message = next[index]!;
    if (shouldMoveReportContent && message.content.trim()) {
      movedContent = movedContent || message.content;
    }
    const baseDr: ChatMessageDeepResearch = message.deep_research ?? {
      runId: latest.runId,
      status: "awaiting_clarify",
      events: historicalEvents,
      artifactIds: [],
    };
    next[index] = {
      ...message,
      content: shouldMoveReportContent && movedContent ? "" : message.content,
      deep_research: freezePlanChatSourceDeepResearch(
        {
          ...baseDr,
          runId: latest.runId,
          status: "awaiting_clarify",
          events: historicalEvents.length > 0 ? historicalEvents : baseDr.events,
          artifactIds: [],
        },
        keepVersion,
      ),
    };
  }

  if (lateIndices.length > 0) {
    const targetIdx = lateIndices[lateIndices.length - 1]!;
    const target = next[targetIdx]!;
    next[targetIdx] = {
      ...target,
      content: movedContent || target.content,
      deep_research: workbench,
    };
    return next;
  }

  // 历史里只有首轮卡 + 改计划用户话：在用户话后插入执行气泡。
  const revisionUser = next[lastRevisionIdx]!;
  const baseMs = Date.parse(revisionUser.created_at) || Date.now();
  const synthetic: ChatMessage = {
    id: `dr-assistant-${latest.runId}-exec`,
    session_id: latest.sessionId,
    tenant_id: revisionUser.tenant_id,
    user_id: revisionUser.user_id,
    role: "assistant",
    content: movedContent,
    created_at: new Date(baseMs + 1).toISOString(),
    deep_research: workbench,
  };
  return [...next.slice(0, lastRevisionIdx + 1), synthetic, ...next.slice(lastRevisionIdx + 1)];
}

/**
 * Attach run-store events onto the last assistant message that lacks a workbench,
 * so refresh / session-switch still shows 冷启动 / 澄清 / 调研车道.
 *
 * 对旧客户端或断流窗口缺失的消息，按精确 topic 归属补齐 assistant 壳；
 * 找不到安全归属时才合成完整 turn，避免把工作台挂到较早的普通回答。
 */
export function mergeDeepResearchHydrate(
  messages: ChatMessage[],
  latest: HydrateDeepResearchRun | null | undefined,
): ChatMessage[] {
  if (!latest?.runId || !Array.isArray(latest.events) || latest.events.length === 0) {
    return messages;
  }

  const workbench = buildWorkbenchFromLatest(latest);
  const repaired = repairPlanChatHydrateTimeline(messages, latest, workbench);
  if (repaired) return repaired;

  // Overlay: chat history may hold a stale workbench (e.g. stream broke after
  // emitting `research_plan proposed`, but the run later approved + ran lanes +
  // failed). Prefer the **latest** same-run assistant so plan_chat 多卡不被首卡抢走。
  const overlayIndex = findLastSameRunAssistantIndex(messages, latest.runId);
  if (overlayIndex >= 0) {
    const existing = messages[overlayIndex]!.deep_research!;
    const latestStatus = normalizeStatus(String(latest.status));
    const stale =
      existing.runId !== latest.runId ||
      existing.events.length < latest.events.length ||
      existing.status !== latestStatus ||
      (Boolean(workbench.profile) && !existing.profile) ||
      (Boolean(workbench.plan) && existing.planVersion !== workbench.planVersion) ||
      (TERMINAL.has(latestStatus) && existing.status === "awaiting_clarify");
    if (stale) {
      const next = messages.slice();
      next[overlayIndex] = {
        ...messages[overlayIndex]!,
        deep_research: {
          ...workbench,
          ...(existing.clarifyAnswers
            ? { clarifyAnswers: existing.clarifyAnswers }
            : {}),
        },
      };
      return next;
    }
    return messages;
  }

  const topic = latest.topic.trim();
  let matchingUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user" && topic && m.content.trim() === topic) {
      matchingUserIndex = i;
      break;
    }
  }

  if (matchingUserIndex >= 0) {
    for (let i = matchingUserIndex + 1; i < messages.length; i += 1) {
      const message = messages[i];
      if (!message || message.role === "user") break;
      if (message.role !== "assistant") continue;
      const existingRunId = message.deep_research?.runId;
      if (
        existingRunId &&
        !isPlaceholderRunId(existingRunId) &&
        existingRunId !== latest.runId
      ) {
        return messages;
      }
      const next = messages.slice();
      next[i] = {
        ...message,
        deep_research: {
          ...workbench,
          ...(message.deep_research?.clarifyAnswers
            ? { clarifyAnswers: message.deep_research.clarifyAnswers }
            : {}),
        },
      };
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

  const hasWorkbench = messages.some(
    (message) =>
      message.role === "assistant" &&
      (message.deep_research?.events?.length ?? 0) > 0,
  );
  if (hasWorkbench) return messages;

  // A completed legacy turn may have retained its answer body but lost only
  // metadata. Never use this heuristic for an active run.
  const lastIndex = messages.length - 1;
  if (
    TERMINAL.has(workbench.status) &&
    lastIndex >= 0 &&
    messages[lastIndex]?.role === "assistant"
  ) {
    const next = messages.slice();
    next[lastIndex] = { ...messages[lastIndex]!, deep_research: workbench };
    return next;
  }

  const tenantId = messages[0]?.tenant_id ?? "tenant";
  const userId = messages[0]?.user_id ?? "user";
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
  return [
    ...messages,
    ...(syntheticUser ? [syntheticUser] : []),
    syntheticAssistant,
  ];
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
  // Always pull run-store latest so a stale chat-history workbench (stream broke
  // mid-run) gets overlaid with the real run status instead of showing an
  // interactive plan card that would only yield "alreadyContinued" on submit.
  const latest = await fetchLatestDeepResearchForHydrate(sessionId, fetchImpl);
  return mergeDeepResearchHydrate(messages, latest);
}
