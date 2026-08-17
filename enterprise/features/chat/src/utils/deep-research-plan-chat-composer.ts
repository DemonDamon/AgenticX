import type { ChatMessage, DeepResearchEvent, ResearchPlanSnapshot } from "@agenticx/core-api";
import { parseClarifyResumeResponse } from "./deep-research-clarify-resume";
import { getDeepResearchInteractionPref } from "./deep-research-interaction-pref";

export type ActivePlanChatGate = {
  runId: string;
  plan: ResearchPlanSnapshot;
  assistantMessageId: string;
  topic: string;
};

/** 开题冷启动车道，出现在 plan gate 之前，不得当作「已开始调研」。 */
function isReconLaneStarted(event: DeepResearchEvent): boolean {
  if (event.type !== "lane_started") return false;
  const id = event.laneId ?? "";
  return id === "recon-cold-start" || id.startsWith("recon-");
}

/**
 * 计划对齐 gate 是否仍可交互。
 * - 最新 plan 仍为 proposed/updated
 * - 尚未 approved
 * - 忽略 recon-cold-start（否则第一轮出方案后主输入永远显示停止钮、第二句进排队）
 */
export function isPlanChatGatePending(events: DeepResearchEvent[]): boolean {
  let sawApproved = false;
  let sawResearchLanes = false;
  let latest: Extract<DeepResearchEvent, { type: "research_plan" }> | null = null;
  for (const event of events) {
    if (event.type === "research_plan") {
      latest = event;
      if (event.action === "approved") sawApproved = true;
    }
    if (event.type === "lane_started" && !isReconLaneStarted(event)) {
      sawResearchLanes = true;
    }
  }
  if (sawApproved || sawResearchLanes || !latest) return false;
  return latest.action === "proposed" || latest.action === "updated";
}

function resolvePlanVisibility(
  dr: NonNullable<ChatMessage["deep_research"]>,
): "hidden" | "preview" | "editable" | "chat_editable" {
  if (dr.profile?.planVisibility) return dr.profile.planVisibility;
  for (let i = (dr.events?.length ?? 0) - 1; i >= 0; i -= 1) {
    const event = dr.events![i]!;
    if (event.type === "research_profile") return event.planVisibility;
  }
  return "hidden";
}

function latestPlanSnapshot(
  dr: NonNullable<ChatMessage["deep_research"]>,
): ResearchPlanSnapshot | null {
  if (dr.plan?.subQuestions?.length) return dr.plan;
  for (let i = (dr.events?.length ?? 0) - 1; i >= 0; i -= 1) {
    const event = dr.events![i]!;
    if (event.type === "research_plan" && event.plan?.subQuestions?.length) {
      return event.plan;
    }
  }
  return null;
}

/**
 * 是否应按「计划对齐」处理：planVisibility=chat_editable / clarify_chat phase=plan /
 * 用户偏好「计划对齐」且 plan 未 approved（防 research_profile 未进 store）。
 * 兜底：plan 仍在 gate（与卡片可交互一致）。
 */
function isPlanChatMode(dr: NonNullable<ChatMessage["deep_research"]>): boolean {
  const events = dr.events ?? [];
  if (!isPlanChatGatePending(events)) return false;
  if (resolvePlanVisibility(dr) === "chat_editable") return true;
  if (events.some((e) => e.type === "clarify_chat" && e.phase === "plan")) return true;
  if (getDeepResearchInteractionPref() === "plan_chat") return true;
  return true;
}

/**
 * 当前会话是否处于「计划对齐」多轮 gate：主输入框应改计划，而非排队新一轮对话。
 *
 * 只要 plan 仍未 approved/未开车道，主输入只改方案（不再要求 runId/plan 快照齐全，
 * 快照缺失时由后端按 runId + 客户端 topic 恢复）。
 * 只有 running / awaiting_clarify 仍可继续；所有终态都只读。
 */
export function findActivePlanChatGate(
  messages: ChatMessage[],
  sessionId: string,
): ActivePlanChatGate | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.session_id !== sessionId || message.role !== "assistant") {
      continue;
    }
    const dr = message.deep_research;
    if (!dr) continue;
    if (dr.status !== "running" && dr.status !== "awaiting_clarify") continue;
    const events = dr.events ?? [];
    if (!isPlanChatGatePending(events)) continue;
    if (!isPlanChatMode(dr)) continue;
    const runId = dr.runId?.trim();
    if (!runId || runId === "pending") continue;
    // 同 run 已有更新方案卡时，旧卡不再充当 active gate（否则会抢「开始调研」语义）。
    const hasNewerSameRun = messages.slice(i + 1).some(
      (later) =>
        later.session_id === sessionId &&
        later.role === "assistant" &&
        later.deep_research?.runId === runId,
    );
    if (hasNewerSameRun) continue;
    const latestUser = [...messages]
      .reverse()
      .find((m) => m.session_id === sessionId && m.role === "user" && m.content.trim())
      ?.content.trim();
    const plan =
      latestPlanSnapshot(dr) ??
      ({
        version: 1,
        objective: latestUser || "研究计划",
        scope: [],
        subQuestions: [{ id: "sq1", title: latestUser || "研究该主题" }],
        sourceStrategy: [],
        deliverables: [],
        assumptions: [],
      } satisfies ResearchPlanSnapshot);
    const topic =
      plan.objective?.trim() ||
      [...messages]
        .reverse()
        .find((m) => m.session_id === sessionId && m.role === "user" && m.content.trim())
        ?.content.trim() ||
      "";
    return {
      runId,
      plan,
      assistantMessageId: message.id,
      topic,
    };
  }
  return null;
}

/**
 * SSE 仍绑在首轮 assistantId 上：执行阶段事件（车道/phase/…）应落到
 * 同一 runId 的最新方案卡气泡，保持「第二张卡 → 开始调研 → 车道」的时间线。
 */
export function resolveDeepResearchEventTargetAssistantId(
  messages: ChatMessage[],
  streamAssistantId: string,
  event: DeepResearchEvent,
): string {
  const streamMsg = messages.find((m) => m.id === streamAssistantId);
  if (!streamMsg) return streamAssistantId;
  const runId =
    ("runId" in event && typeof event.runId === "string" && event.runId.trim()) ||
    streamMsg.deep_research?.runId?.trim() ||
    "";
  if (!runId) return streamAssistantId;
  // updated 分叉仍以流式源消息为锚点（fork 逻辑需要）。
  if (event.type === "research_plan" && event.action === "updated") {
    return streamAssistantId;
  }
  let latestId = streamAssistantId;
  for (const message of messages) {
    if (message.session_id !== streamMsg.session_id) continue;
    if (message.role !== "assistant" || !message.deep_research) continue;
    if (message.deep_research.runId === runId) {
      latestId = message.id;
    }
  }
  return latestId;
}

/** Debug helper: explain why findActivePlanChatGate returned null. */
export function debugPlanChatGate(
  messages: ChatMessage[],
  sessionId: string,
): Record<string, unknown> {
  const candidate = [...messages]
    .reverse()
    .find(
      (m) => m.session_id === sessionId && m.role === "assistant" && m.deep_research,
    );
  if (!candidate?.deep_research) return { found: false, reason: "no deep_research message" };
  const dr = candidate.deep_research;
  const latestPlan = [...(dr.events ?? [])].reverse().find((e) => e.type === "research_plan") as
    | Extract<DeepResearchEvent, { type: "research_plan" }>
    | undefined;
  return {
    found: true,
    status: dr.status,
    runId: dr.runId,
    hasProfile: Boolean(dr.profile),
    planVisibility: dr.profile?.planVisibility ?? null,
    resolvedVisibility: resolvePlanVisibility(dr),
    gatePending: isPlanChatGatePending(dr.events ?? []),
    planMode: isPlanChatMode(dr),
    hasPlanSnapshot: Boolean(latestPlanSnapshot(dr)?.subQuestions?.length),
    lastPlanAction: latestPlan?.action ?? null,
    eventTypes: (dr.events ?? []).slice(-12).map((e) => e.type),
  };
}

/** 事件流里是否处于「正在根据反馈更新计划」的短暂态。 */
export function isPlanChatUpdating(events: Array<{ type: string; text?: string; action?: string }>): boolean {
  let busy = false;
  for (const event of events) {
    if (
      event.type === "narrative" &&
      typeof event.text === "string" &&
      /正在根据你的反馈更新计划/.test(event.text)
    ) {
      busy = true;
      continue;
    }
    if (event.type === "research_plan") {
      busy = false;
    }
  }
  return busy;
}

export type PlanChatComposerResumeResult =
  | {
      kind: "resumed";
      plan?: ResearchPlanSnapshot;
      version?: number;
    }
  | { kind: "already_continued"; message: string }
  | { kind: "error"; message: string };

export async function postPlanChatComposerReply(input: {
  runId: string;
  chatReply: string;
  plan: ResearchPlanSnapshot;
  sessionId?: string;
  topic?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<PlanChatComposerResumeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl("/api/chat/deep-research/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: input.runId,
      chatReply: input.chatReply.slice(0, 2_000),
      planSnapshot: input.plan,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.model ? { model: input.model } : {}),
    }),
  });
  const bodyText = await res.text();
  return parseClarifyResumeResponse(res.status, bodyText, "plan");
}

/** /api/chat/deep-research/runs hydrate 返回的最小形态（改计划后回填卡片用）。 */
type RunsHydratePayload = {
  runId: string;
  status?: string;
  phase?: string;
  events?: DeepResearchEvent[];
};

/** 拉 run-store 最新事件（改计划后服务端的 SSE 未必还连着当前窗格）。 */
export async function fetchPlanChatRunDetail(
  runId: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RunsHydratePayload | null> {
  try {
    const res = await fetchImpl(
      `/api/chat/deep-research/runs?hydrate=1&sessionId=${encodeURIComponent(sessionId)}`,
    );
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      data?: { latest?: RunsHydratePayload | null };
    };
    const latest = payload?.data?.latest;
    if (!latest || typeof latest !== "object") return null;
    if (latest.runId !== runId) return null;
    return { ...latest, runId: latest.runId ?? runId };
  } catch {
    return null;
  }
}

export function latestResearchPlanFromEvents(
  events: DeepResearchEvent[],
): Extract<DeepResearchEvent, { type: "research_plan" }> | null {
  let latest: Extract<DeepResearchEvent, { type: "research_plan" }> | null = null;
  for (const event of events) {
    if (event.type === "research_plan") latest = event;
  }
  return latest;
}

/** 会话里是否已有同一 run + version 的计划对齐助手气泡（防 SSE/composer 双开卡）。 */
export function sessionHasPlanChatVersion(
  messages: ChatMessage[],
  sessionId: string,
  runId: string,
  version: number,
): boolean {
  for (const message of messages) {
    if (message.session_id !== sessionId || message.role !== "assistant") continue;
    const dr = message.deep_research;
    if (!dr || dr.runId !== runId) continue;
    if ((dr.planVersion ?? dr.plan?.version) === version) return true;
    if ((dr.events ?? []).some((e) => e.type === "research_plan" && e.version === version)) {
      return true;
    }
  }
  return false;
}

type DeepResearchState = NonNullable<ChatMessage["deep_research"]>;

/** 旧方案卡：去掉「更新中」旁白，并丢掉更高版本的 research_plan（改计划改出新气泡）。 */
export function freezePlanChatSourceDeepResearch(
  dr: DeepResearchState,
  keepVersionMax: number,
): DeepResearchState {
  const events = (dr.events ?? []).filter((event) => {
    if (
      event.type === "narrative" &&
      /正在根据你的反馈更新计划/.test(event.text)
    ) {
      return false;
    }
    if (event.type === "research_plan" && event.version > keepVersionMax) {
      return false;
    }
    return true;
  });
  const keptPlan = latestResearchPlanFromEvents(events);
  return {
    ...dr,
    status: "awaiting_clarify",
    events: events.slice(-200),
    ...(keptPlan
      ? { plan: keptPlan.plan, planVersion: keptPlan.version }
      : {}),
  };
}

/** 改计划成功后：在用户反馈下方挂一张新的方案卡消息。 */
export function buildPlanChatRevisionAssistantMessage(input: {
  id: string;
  sessionId: string;
  tenantId: string;
  userId: string;
  runId: string;
  plan: ResearchPlanSnapshot;
  version: number;
  profile?: DeepResearchState["profile"];
  createdAt?: string;
}): ChatMessage {
  const version = Math.max(1, input.version);
  const plan = { ...input.plan, version };
  const events: DeepResearchEvent[] = [];
  if (input.profile) {
    events.push({
      type: "research_profile",
      runId: input.runId,
      researchDepth: input.profile.researchDepth,
      clarifyMode: input.profile.clarifyMode,
      clarifyBudget: input.profile.clarifyBudget,
      planVisibility: input.profile.planVisibility,
      assumptions: input.profile.assumptions,
    });
  } else {
    events.push({
      type: "research_profile",
      runId: input.runId,
      researchDepth: "deep",
      clarifyMode: "none",
      clarifyBudget: { maxRounds: 3, allowMidRun: true },
      planVisibility: "chat_editable",
      assumptions: ["计划可经多轮对话调整；未修改则按当前草案执行。"],
    });
  }
  events.push({
    type: "research_plan",
    runId: input.runId,
    action: "updated",
    version,
    plan,
  });
  events.push({
    type: "clarify_chat",
    runId: input.runId,
    roundIndex: Math.max(0, version - 1),
    phase: "plan",
    promptText: `方案已更新（当前计划 v${version}）。可继续在下方修改，或点「开始调研」。`,
  });
  return {
    id: input.id,
    session_id: input.sessionId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    role: "assistant",
    content: "已根据你的反馈生成新一版研究计划。",
    created_at: input.createdAt ?? new Date().toISOString(),
    deep_research: {
      runId: input.runId,
      status: "awaiting_clarify",
      events,
      artifactIds: [],
      ...(input.profile
        ? { profile: input.profile }
        : {
            profile: {
              researchDepth: "deep" as const,
              clarifyMode: "none" as const,
              clarifyBudget: { maxRounds: 3, allowMidRun: true },
              planVisibility: "chat_editable" as const,
              assumptions: ["计划可经多轮对话调整；未修改则按当前草案执行。"],
            },
          }),
      plan,
      planVersion: version,
    },
  };
}
