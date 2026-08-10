import { NextResponse } from "next/server";
import type { ResearchPlanSnapshot } from "@agenticx/sdk-ts";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  getSessionAuthFromCookies,
  isAuthCookieSecure,
} from "../../../../../lib/session";
import { refreshTokens } from "../../../../../lib/auth-runtime";
import { cookies } from "next/headers";
import { loadTenantWebSearchConfig } from "../../../../../lib/web-search/tenant-config";
import { defaultArtifactStore } from "../../../../../lib/deep-research/artifact-store";
import {
  parsePlanPatchSubQuestions,
  runDeepResearchTurn,
} from "../../../../../lib/deep-research/orchestrator";
import {
  isOrphanedPlanGate,
  latestResearchPlanEvent,
  orphanGateKind,
  parseClientPlanSnapshot,
  snapshotToResearchPlan,
  toPlanSnapshot,
} from "../../../../../lib/deep-research/plan-gate-orphan";
import { defaultRunStore } from "../../../../../lib/deep-research/run-store";
import {
  syncRevisePlanChat,
  waitForResearchPlanBump,
} from "../../../../../lib/deep-research/plan-chat-revise";
import {
  awaitPeerClarifyHandoff,
  CHAT_CLARIFY_ANSWER_KEY,
  hasLiveClarifyWaiter,
  MAX_GATE_ANSWER_CHARS,
  MAX_PLAN_PATCH_CHARS,
  PLAN_GATE_ACTION_KEY,
  PLAN_GATE_PATCH_KEY,
  resolveClarifyResume,
} from "../../../../../lib/deep-research/run-wait";
import { withRequestLog } from "../../../../../lib/observability/with-request-log";

export const runtime = "nodejs";
export const maxDuration = 1500;

const PLAN_ACTIONS = new Set(["approve", "edit", "skip"]);

const GATEWAY_COMPLETIONS_URL =
  process.env.GATEWAY_COMPLETIONS_URL ?? "http://127.0.0.1:8088/v1/chat/completions";

type OrphanGlobal = typeof globalThis & {
  __agxOrphanPlanContinues?: Set<string>;
};

function orphanContinues(): Set<string> {
  const g = globalThis as OrphanGlobal;
  if (!g.__agxOrphanPlanContinues) g.__agxOrphanPlanContinues = new Set();
  return g.__agxOrphanPlanContinues;
}

/** Drain continue SSE so the pipeline keeps running without a browser listener. */
async function drainResponseBody(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // transport cancelled mid-continue — run-store writer may still finish
  }
}

function alreadyContinued(runId: string) {
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { runId, resumed: false, alreadyContinued: true },
  });
}

export async function POST(request: Request) {
  return withRequestLog("deep_research.resume", async (logCtx) => {
  const auth = await getSessionAuthFromCookies();
  if (!auth) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 },
    );
  }
  const { session, accessToken } = auth;
  let refreshToken = auth.refreshToken;
  logCtx.setUser({
    userId: session.userId,
    tenantId: session.tenantId,
  });

  let body: {
    runId?: unknown;
    answers?: unknown;
    skip?: unknown;
    chatReply?: unknown;
    planAction?: unknown;
    planPatch?: unknown;
    planSnapshot?: unknown;
    sessionId?: unknown;
    topic?: unknown;
    model?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: { code: "40001", message: "invalid json body" } },
      { status: 400 },
    );
  }

  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) {
    return NextResponse.json(
      { error: { code: "40001", message: "runId required" } },
      { status: 400 },
    );
  }

  const answers: Record<string, string> = {};
  const chatReply = typeof body.chatReply === "string" ? body.chatReply.trim() : "";
  if (chatReply) {
    // chatReply 与结构化 answers 互斥：对话式澄清只有一段自由文本。
    answers[CHAT_CLARIFY_ANSWER_KEY] = chatReply.slice(0, MAX_GATE_ANSWER_CHARS);
  } else if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
    for (const [key, value] of Object.entries(body.answers as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) {
        answers[key] = value.trim().slice(0, MAX_GATE_ANSWER_CHARS);
      }
    }
  }

  // 计划 gate：动作 + 白名单补丁（JSON string；orchestrator 侧再做 schema 校验）。
  if (typeof body.planAction === "string" && PLAN_ACTIONS.has(body.planAction)) {
    answers[PLAN_GATE_ACTION_KEY] = body.planAction;
  }
  if (typeof body.planPatch === "string" && body.planPatch.trim()) {
    answers[PLAN_GATE_PATCH_KEY] = body.planPatch.slice(0, MAX_PLAN_PATCH_CHARS);
  }

  const skip =
    body.skip === true ||
    (Object.keys(answers).length === 0 && body.planAction === undefined);

  const clientPlanEarly = parseClientPlanSnapshot(body.planSnapshot);
  const chatReplyTextEarly = answers[CHAT_CLARIFY_ANSWER_KEY]?.trim() ?? "";
  const isPlanChatReply =
    Boolean(chatReplyTextEarly) && clientPlanEarly != null;

  const modelRawEarly = typeof body.model === "string" ? body.model.trim() : "";
  let providerHintEarly = "";
  let modelNameEarly = modelRawEarly || "default";
  if (modelRawEarly.includes("/")) {
    const [providerId, ...rest] = modelRawEarly.split("/");
    const name = rest.join("/");
    if (providerId && name) {
      providerHintEarly = providerId;
      modelNameEarly = name;
    }
  }
  const gatewayHeadersEarly: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    "x-tenant-id": session.tenantId,
    "x-user-id": session.userId,
    "x-dept-id": session.deptId ?? "",
    "x-user-email": session.email,
    "x-session-id": session.sessionId,
    ...(providerHintEarly ? { "x-agenticx-provider": providerHintEarly } : {}),
  };

  /**
   * 计划对齐「主输入改计划」：必须在本请求内返回新 plan。
   * 旧路径（只 wake waiter / 后台 orphan + 前端轮询）会在 SSE 断开或
   * stale disk 时假成功，UI 只见用户气泡、方案永不更新。
   */
  if (isPlanChatReply && clientPlanEarly) {
    const baselineVersion = clientPlanEarly.version;
    const hadLiveWaiter = hasLiveClarifyWaiter(runId);
    const ok = resolveClarifyResume(runId, { answers, skip: false });

    if (ok && hadLiveWaiter) {
      const bumped = await waitForResearchPlanBump({
        runStore: defaultRunStore,
        tenantId: session.tenantId,
        userId: session.userId,
        runId,
        baselineVersion,
        timeoutMs: 90_000,
      });
      if (bumped) {
        return NextResponse.json({
          code: "00000",
          message: "ok",
          data: {
            runId,
            resumed: true,
            planChat: true,
            version: bumped.version,
            plan: bumped.plan,
          },
        });
      }
      return NextResponse.json(
        { error: { code: "50401", message: "计划更新超时，请重试。" } },
        { status: 504 },
      );
    }

    if (ok && !hadLiveWaiter) {
      const handoff = await awaitPeerClarifyHandoff(runId, 800);
      if (handoff === "delivered") {
        const bumped = await waitForResearchPlanBump({
          runStore: defaultRunStore,
          tenantId: session.tenantId,
          userId: session.userId,
          runId,
          baselineVersion,
          timeoutMs: 90_000,
        });
        if (bumped) {
          return NextResponse.json({
            code: "00000",
            message: "ok",
            data: {
              runId,
              resumed: true,
              planChat: true,
              version: bumped.version,
              plan: bumped.plan,
            },
          });
        }
      }
    }

    // 无活人 waiter：本请求内同步改计划并写回 run-store。
    let run = await defaultRunStore.get(session.tenantId, session.userId, runId);
    const clientSessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim().slice(0, 128) : "";
    const clientTopic =
      typeof body.topic === "string" ? body.topic.trim().slice(0, 500) : "";
    if (run?.status === "completed") {
      return alreadyContinued(runId);
    }
    // 已开车道 / 已批准 → 不能再改计划
    if (run && orphanGateKind(run.events) !== "plan") {
      return alreadyContinued(runId);
    }

    let proposedSnapshot = clientPlanEarly;
    let proposedVersion = clientPlanEarly.version;
    if (run && orphanGateKind(run.events) === "plan") {
      const proposed = latestResearchPlanEvent(run.events);
      if (proposed?.action === "proposed" || proposed?.action === "updated") {
        proposedSnapshot = proposed.plan;
        proposedVersion = proposed.version;
      }
    }

    const sessionId = (run?.sessionId || clientSessionId).trim();
    const topic = (run?.topic || clientTopic || proposedSnapshot.objective).trim();
    if (!sessionId) {
      return NextResponse.json(
        { error: { code: "40001", message: "sessionId required to continue plan gate" } },
        { status: 400 },
      );
    }

    if (!run) {
      try {
        run = await defaultRunStore.create({
          runId,
          tenantId: session.tenantId,
          userId: session.userId,
          sessionId,
          topic: topic || proposedSnapshot.objective,
        });
        await defaultRunStore.appendEvents(
          runId,
          [
            { type: "run_started", runId },
            {
              type: "research_plan",
              runId,
              action: "proposed",
              version: proposedVersion,
              plan: proposedSnapshot,
            },
          ],
          { status: "awaiting_clarify", phase: "plan" },
        );
        run = await defaultRunStore.get(session.tenantId, session.userId, runId);
      } catch (error) {
        console.warn("[deep-research] plan_chat sync recreate failed:", error);
        return NextResponse.json(
          { error: { code: "50000", message: "failed to recreate plan gate run" } },
          { status: 500 },
        );
      }
    } else if (run.status === "failed" || run.status === "cancelled") {
      const reopened = await defaultRunStore.reopenForContinue(runId, {
        status: "awaiting_clarify",
        phase: "plan",
      });
      if (!reopened) return alreadyContinued(runId);
      run = await defaultRunStore.get(session.tenantId, session.userId, runId);
    }

    if (!run) return alreadyContinued(runId);

    try {
      const revised = await syncRevisePlanChat({
        runStore: defaultRunStore,
        runId,
        chatReply: chatReplyTextEarly,
        proposedSnapshot,
        proposedVersion,
        topic: topic || proposedSnapshot.objective,
        originalQuery: topic || proposedSnapshot.objective,
        priorEvents: run.events,
        gateway: {
          url: GATEWAY_COMPLETIONS_URL,
          headers: gatewayHeadersEarly,
          model: modelNameEarly,
        },
      });
      return NextResponse.json({
        code: "00000",
        message: "ok",
        data: {
          runId,
          resumed: true,
          planChat: true,
          syncRevised: true,
          version: revised.version,
          plan: revised.plan,
          ...("skippedApprove" in revised && revised.skippedApprove
            ? { skippedApprove: true }
            : {}),
        },
      });
    } catch (error) {
      console.warn("[deep-research] plan_chat sync revise failed:", error);
      return NextResponse.json(
        { error: { code: "50000", message: "计划更新失败，请重试。" } },
        { status: 500 },
      );
    }
  }

  // Live waiter → 本进程 SSE 立刻续跑。仅磁盘 waiting 可能是跨 isolate，也可能是
  // 重启后残留无人监听的 stale 文件：后者若直接 resumed:true 会跳过孤儿恢复。
  const hadLiveWaiter = hasLiveClarifyWaiter(runId);
  const ok = resolveClarifyResume(runId, { answers, skip });
  if (ok && hadLiveWaiter) {
    return NextResponse.json({ code: "00000", message: "ok", data: { runId, resumed: true } });
  }
  if (ok && !hadLiveWaiter) {
    const handoff = await awaitPeerClarifyHandoff(runId, 800);
    if (handoff === "delivered") {
      return NextResponse.json({ code: "00000", message: "ok", data: { runId, resumed: true } });
    }
    // stale disk resolve → fall through to plan orphan recovery when possible
  }

  const planAction =
    answers[PLAN_GATE_ACTION_KEY]?.trim() ||
    (skip && body.skip === true ? "skip" : "");
  const isPlanResume =
    Boolean(answers[PLAN_GATE_ACTION_KEY]) ||
    (typeof body.planAction === "string" && PLAN_ACTIONS.has(body.planAction)) ||
    (body.skip === true && clientPlanEarly != null);

  if (!isPlanResume) {
    // 非计划 gate：磁盘握手失败则保持旧语义（已继续 / 无等待方）。
    return alreadyContinued(runId);
  }

  // --- Orphan / client-attested plan gate continue ---
  let run = await defaultRunStore.get(session.tenantId, session.userId, runId);
  const clientPlan = clientPlanEarly;
  const clientSessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim().slice(0, 128) : "";
  const clientTopic =
    typeof body.topic === "string" ? body.topic.trim().slice(0, 500) : "";

  // Successfully finished runs must not be restarted from a stale plan card.
  if (run?.status === "completed") {
    return alreadyContinued(runId);
  }
  // Server already past plan gate → do not re-run even if UI still shows a draft.
  if (run && orphanGateKind(run.events) !== "plan") {
    return alreadyContinued(runId);
  }
  // Store wiped on restart: require client snapshot to rebuild.
  if (!run && !clientPlan) {
    return alreadyContinued(runId);
  }
  // Run exists but not orphan-eligible and no client snapshot (should be rare).
  if (run && !isOrphanedPlanGate(run) && !clientPlan) {
    return alreadyContinued(runId);
  }

  let proposedSnapshot: ResearchPlanSnapshot | null = null;
  let proposedVersion = 1;
  let proposedAssumptions: string[] = [];

  if (run && orphanGateKind(run.events) === "plan") {
    const proposed = latestResearchPlanEvent(run.events);
    if (proposed?.action === "proposed" || proposed?.action === "updated") {
      proposedSnapshot = proposed.plan;
      proposedVersion = proposed.version;
      proposedAssumptions = proposed.plan.assumptions ?? [];
    }
  }

  if (!proposedSnapshot && clientPlan) {
    proposedSnapshot = clientPlan;
    proposedVersion = clientPlan.version;
    proposedAssumptions = clientPlan.assumptions ?? [];
  }

  if (!proposedSnapshot) {
    return alreadyContinued(runId);
  }

  const sessionId = (run?.sessionId || clientSessionId).trim();
  const topic = (run?.topic || clientTopic || proposedSnapshot.objective).trim();
  if (!sessionId) {
    return NextResponse.json(
      { error: { code: "40001", message: "sessionId required to continue plan gate" } },
      { status: 400 },
    );
  }

  // Recreate run when memory store was wiped on restart.
  if (!run) {
    try {
      run = await defaultRunStore.create({
        runId,
        tenantId: session.tenantId,
        userId: session.userId,
        sessionId,
        topic: topic || proposedSnapshot.objective,
      });
      await defaultRunStore.appendEvents(
        runId,
        [
          { type: "run_started", runId },
          {
            type: "research_plan",
            runId,
            action: "proposed",
            version: proposedVersion,
            plan: proposedSnapshot,
          },
        ],
        { status: "awaiting_clarify", phase: "plan" },
      );
      run = await defaultRunStore.get(session.tenantId, session.userId, runId);
    } catch (error) {
      console.warn("[deep-research] orphan plan recreate failed:", error);
      return NextResponse.json(
        { error: { code: "50000", message: "failed to recreate plan gate run" } },
        { status: 500 },
      );
    }
  } else if (run.status === "failed" || run.status === "cancelled") {
    const reopened = await defaultRunStore.reopenForContinue(runId, {
      status: "awaiting_clarify",
      phase: "plan",
    });
    if (!reopened) {
      return alreadyContinued(runId);
    }
  }

  if (!run) {
    return alreadyContinued(runId);
  }

  const locks = orphanContinues();
  if (locks.has(runId)) {
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { runId, resumed: true, orphanContinued: true },
    });
  }
  locks.add(runId);

  const chatReplyText = answers[CHAT_CLARIFY_ANSWER_KEY]?.trim() ?? "";
  const reenterPlanChat =
    Boolean(chatReplyText) &&
    !planAction &&
    body.skip !== true;

  let plan = snapshotToResearchPlan(proposedSnapshot, topic || proposedSnapshot.objective);
  let planVersion = proposedVersion;

  // Reconstruct prior plan-chat turns from events (user replies + update narratives).
  const planChatHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  let planChatRoundsUsed = 0;
  for (const event of run.events) {
    if (event.type === "clarify_chat" && event.phase === "plan") {
      // roundIndex tracks completed user reply rounds before this prompt
      planChatRoundsUsed = Math.max(planChatRoundsUsed, event.roundIndex);
    }
    if (event.type === "narrative" && typeof event.text === "string") {
      const userPrefix = "你：";
      if (event.text.startsWith(userPrefix)) {
        const content = event.text.slice(userPrefix.length).trim();
        if (content) planChatHistory.push({ role: "user", content });
      }
    }
    if (event.type === "research_plan" && event.action === "updated") {
      planChatHistory.push({
        role: "assistant",
        content: `已更新计划 v${event.version}`,
      });
    }
  }

  const modelRaw = typeof body.model === "string" ? body.model.trim() : "";
  let providerHint = "";
  let modelName = modelRaw || "default";
  if (modelRaw.includes("/")) {
    const [providerId, ...rest] = modelRaw.split("/");
    const name = rest.join("/");
    if (providerId && name) {
      providerHint = providerId;
      modelName = name;
    }
  }

  const gatewayHeaders: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    "x-tenant-id": session.tenantId,
    "x-user-id": session.userId,
    "x-dept-id": session.deptId ?? "",
    "x-user-email": session.email,
    "x-session-id": session.sessionId,
    ...(providerHint ? { "x-agenticx-provider": providerHint } : {}),
  };

  if (reenterPlanChat) {
    try {
      if (run.status === "failed" || run.status === "cancelled" || run.status === "completed") {
        await defaultRunStore.reopenForContinue(runId, {
          status: "awaiting_clarify",
          phase: "plan",
        });
      } else {
        await defaultRunStore.appendEvents(runId, [], {
          status: "awaiting_clarify",
          phase: "plan",
        });
      }
    } catch (error) {
      locks.delete(runId);
      console.warn("[deep-research] orphan plan_chat reopen failed:", error);
      return NextResponse.json(
        { error: { code: "50000", message: "failed to continue plan chat" } },
        { status: 500 },
      );
    }

    void runDeepResearchTurn(
      {
        model: modelName,
        messages: [{ role: "user", content: topic || plan.topic }],
        agenticx_deep_research_interaction: "plan_chat",
      },
      {
        url: GATEWAY_COMPLETIONS_URL,
        headers: gatewayHeaders,
        loadTenantConfig: () => loadTenantWebSearchConfig(session.tenantId),
        artifactStore: defaultArtifactStore,
        runStore: defaultRunStore,
        tenantId: session.tenantId,
        userId: session.userId,
        sessionId,
        runId,
        awaitClarify: true,
        continueFromPlanGate: {
          plan,
          planVersion,
          topic: topic || plan.topic,
          reenterPlanChat: true,
          pendingChatReply: chatReplyText,
          planChatHistory,
          planChatRoundsUsed,
        },
        refreshAccessToken: async () => {
          if (!refreshToken) return null;
          try {
            const next = await refreshTokens(refreshToken);
            refreshToken = next.refreshToken;
            try {
              const cookieStore = await cookies();
              cookieStore.set(ACCESS_COOKIE, next.accessToken, {
                httpOnly: true,
                sameSite: "lax",
                secure: isAuthCookieSecure(),
                maxAge: next.expiresInSeconds,
                path: "/",
              });
              cookieStore.set(REFRESH_COOKIE, next.refreshToken, {
                httpOnly: true,
                sameSite: "lax",
                secure: isAuthCookieSecure(),
                maxAge: 7 * 24 * 60 * 60,
                path: "/",
              });
            } catch {
              // ignore cookie write during background continue
            }
            return { accessToken: next.accessToken };
          } catch {
            return null;
          }
        },
      },
    )
      .then((response) => drainResponseBody(response))
      .catch((error) => {
        console.warn(
          "[deep-research] orphan plan_chat continue failed:",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        locks.delete(runId);
      });

    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { runId, resumed: true, orphanContinued: true, planChat: true },
    });
  }

  const action = planAction || (skip ? "skip" : "approve");
  let planActionOut: "approved" | "updated" = "approved";
  let narrative = "已确认计划，继续执行研究。";

  if (action === "edit") {
    const patched = parsePlanPatchSubQuestions(answers[PLAN_GATE_PATCH_KEY]);
    if (patched.length > 0) {
      plan = { ...plan, subQuestions: patched };
      planVersion += 1;
      planActionOut = "updated";
      narrative = "已按修改后的计划继续研究。";
    }
  } else if (action === "skip") {
    narrative = "已跳过计划确认，直接开始研究。";
  }

  const snapshot = toPlanSnapshot(plan, planVersion, proposedAssumptions);
  try {
    // Ensure appendEvents is allowed (terminal → active).
    if (run.status === "failed" || run.status === "cancelled" || run.status === "completed") {
      await defaultRunStore.reopenForContinue(runId, { status: "running", phase: "lanes" });
    }
    await defaultRunStore.appendEvents(
      runId,
      [
        {
          type: "research_plan",
          runId,
          action: planActionOut,
          version: planVersion,
          plan: snapshot,
        },
        { type: "narrative", text: narrative },
      ],
      { status: "running", phase: "lanes" },
    );
  } catch (error) {
    locks.delete(runId);
    console.warn("[deep-research] orphan plan append failed:", error);
    return NextResponse.json(
      { error: { code: "50000", message: "failed to continue plan gate" } },
      { status: 500 },
    );
  }

  void runDeepResearchTurn(
    {
      model: modelName,
      messages: [{ role: "user", content: topic || plan.topic }],
    },
    {
      url: GATEWAY_COMPLETIONS_URL,
      headers: gatewayHeaders,
      loadTenantConfig: () => loadTenantWebSearchConfig(session.tenantId),
      artifactStore: defaultArtifactStore,
      runStore: defaultRunStore,
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId,
      runId,
      awaitClarify: false,
      continueFromPlanGate: {
        plan,
        planVersion,
        topic: topic || plan.topic,
        planEventEmitted: true,
      },
      refreshAccessToken: async () => {
        if (!refreshToken) return null;
        try {
          const next = await refreshTokens(refreshToken);
          refreshToken = next.refreshToken;
          try {
            const cookieStore = await cookies();
            cookieStore.set(ACCESS_COOKIE, next.accessToken, {
              httpOnly: true,
              sameSite: "lax",
              secure: isAuthCookieSecure(),
              maxAge: next.expiresInSeconds,
              path: "/",
            });
            cookieStore.set(REFRESH_COOKIE, next.refreshToken, {
              httpOnly: true,
              sameSite: "lax",
              secure: isAuthCookieSecure(),
              maxAge: 7 * 24 * 60 * 60,
              path: "/",
            });
          } catch {
            // ignore cookie write during background continue
          }
          return { accessToken: next.accessToken };
        } catch {
          return null;
        }
      },
    },
  )
    .then((response) => drainResponseBody(response))
    .catch((error) => {
      console.warn(
        "[deep-research] orphan plan continue failed:",
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => {
      locks.delete(runId);
    });

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { runId, resumed: true, orphanContinued: true },
  });
  }, request);
}
