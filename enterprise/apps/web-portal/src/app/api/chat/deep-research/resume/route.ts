import { NextResponse } from "next/server";
import {
  getSessionAuthFromCookies,
  passwordChangeRequiredResponse,
  type SessionAuth,
} from "../../../../../lib/session";
import { defaultArtifactStore } from "../../../../../lib/deep-research/artifact-store";
import {
  parsePlanPatchSubQuestions,
  runDeepResearchTurn,
} from "../../../../../lib/deep-research/orchestrator";
import {
  latestResearchPlanEvent,
  orphanGateKind,
  snapshotToResearchPlan,
  toPlanSnapshot,
} from "../../../../../lib/deep-research/plan-gate-orphan";
import { syncRevisePlanChat } from "../../../../../lib/deep-research/plan-chat-revise";
import {
  defaultRunStore,
  type RunRecord,
} from "../../../../../lib/deep-research/run-store";
import {
  CHAT_CLARIFY_ANSWER_KEY,
  MAX_GATE_ANSWER_CHARS,
  MAX_PLAN_PATCH_CHARS,
  PLAN_GATE_ACTION_KEY,
  PLAN_GATE_PATCH_KEY,
  hasLiveClarifyWaiter,
  notifyClarifyResume,
} from "../../../../../lib/deep-research/run-wait";
import { loadTenantWebSearchConfig } from "../../../../../lib/web-search/tenant-config";
import { reserveTenantDailySearchProviderCall } from "../../../../../lib/web-search/daily-provider-quota";
import { withRequestLog } from "../../../../../lib/observability/with-request-log";

export const runtime = "nodejs";
export const maxDuration = 1500;

const PLAN_ACTIONS = new Set(["approve", "edit", "skip"]);
const ORPHAN_HANDOFF_MS = 1_250;
const GATEWAY_COMPLETIONS_URL =
  process.env.GATEWAY_COMPLETIONS_URL ?? "http://127.0.0.1:8088/v1/chat/completions";

function alreadyContinued(runId: string) {
  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { runId, resumed: false, alreadyContinued: true },
  });
}

async function drainResponseBody(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // Persistence is owned by the run writer, not this internal transport.
  }
}

async function continueClaimedPlanGate(input: {
  run: RunRecord;
  runId: string;
  answers: Record<string, string>;
  chatReply: string;
  skip: boolean;
  model: unknown;
  session: SessionAuth["session"];
  accessToken: string;
  traceId: string;
}): Promise<Response> {
  const latestPlan = latestResearchPlanEvent(input.run.events);
  if (!latestPlan || (latestPlan.action !== "proposed" && latestPlan.action !== "updated")) {
    return alreadyContinued(input.runId);
  }

  let plan = snapshotToResearchPlan(latestPlan.plan, input.run.topic);
  let planVersion = latestPlan.version;
  const modelRaw = typeof input.model === "string" ? input.model.trim() : "";
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
    authorization: `Bearer ${input.accessToken}`,
    "x-tenant-id": input.session.tenantId,
    "x-user-id": input.session.userId,
    "x-dept-id": input.session.deptId ?? "",
    "x-user-email": input.session.email,
    "x-session-id": input.session.sessionId,
    "x-agenticx-trace-id": input.traceId,
    ...(providerHint ? { "x-agenticx-provider": providerHint } : {}),
  };

  if (input.chatReply && !input.answers[PLAN_GATE_ACTION_KEY]) {
    try {
      const revised = await syncRevisePlanChat({
        runStore: defaultRunStore,
        runId: input.runId,
        chatReply: input.chatReply,
        proposedSnapshot: latestPlan.plan,
        proposedVersion: latestPlan.version,
        topic: input.run.topic,
        originalQuery: input.run.topic,
        priorEvents: input.run.events,
        gateway: {
          url: GATEWAY_COMPLETIONS_URL,
          headers: gatewayHeaders,
          model: modelName,
        },
      });
      plan = snapshotToResearchPlan(revised.plan, input.run.topic);
      planVersion = revised.version;
      if (!("skippedApprove" in revised && revised.skippedApprove)) {
        return NextResponse.json({
          code: "00000",
          message: "ok",
          data: {
            runId: input.runId,
            resumed: true,
            planChat: true,
            syncRevised: true,
            version: revised.version,
            plan: revised.plan,
          },
        });
      }
    } catch (error) {
      await defaultRunStore.beginClarification(input.runId, [], null, "plan");
      console.warn("[deep-research] orphan plan revision failed:", error);
      return NextResponse.json(
        { error: { code: "50000", message: "计划更新失败，请重试。" } },
        { status: 500 },
      );
    }
  } else {
    const action = input.answers[PLAN_GATE_ACTION_KEY] ?? (input.skip ? "skip" : "approve");
    let eventAction: "approved" | "updated" = "approved";
    let narrative =
      action === "skip" ? "已跳过计划确认，直接开始研究。" : "已确认计划，继续执行研究。";
    if (action === "edit") {
      const patched = parsePlanPatchSubQuestions(input.answers[PLAN_GATE_PATCH_KEY]);
      if (patched.length > 0) {
        plan = { ...plan, subQuestions: patched };
        planVersion += 1;
        eventAction = "updated";
        narrative = "已按修改后的计划继续研究。";
      }
    }
    try {
      await defaultRunStore.appendEvents(
        input.runId,
        [
          {
            type: "research_plan",
            runId: input.runId,
            action: eventAction,
            version: planVersion,
            plan: toPlanSnapshot(plan, planVersion, latestPlan.plan.assumptions ?? []),
          },
          { type: "narrative", text: narrative },
        ],
        { status: "running", phase: "plan_resuming" },
      );
    } catch (error) {
      await defaultRunStore.beginClarification(input.runId, [], null, "plan");
      console.warn("[deep-research] orphan plan persist failed:", error);
      return NextResponse.json(
        { error: { code: "50000", message: "failed to continue plan gate" } },
        { status: 500 },
      );
    }
  }

  void runDeepResearchTurn(
    { model: modelName, messages: [{ role: "user", content: input.run.topic || plan.topic }] },
    {
      url: GATEWAY_COMPLETIONS_URL,
      headers: gatewayHeaders,
      loadTenantConfig: () => loadTenantWebSearchConfig(input.session.tenantId),
      reserveProviderCall: () => reserveTenantDailySearchProviderCall(input.session.tenantId),
      artifactStore: defaultArtifactStore,
      runStore: defaultRunStore,
      tenantId: input.session.tenantId,
      userId: input.session.userId,
      sessionId: input.run.sessionId,
      runId: input.runId,
      traceId: input.traceId,
      awaitClarify: false,
      continueFromPlanGate: {
        plan,
        planVersion,
        topic: input.run.topic || plan.topic,
        planEventEmitted: true,
      },
    },
  )
    .then((response) => drainResponseBody(response))
    .catch((error) => {
      console.warn(
        "[deep-research] orphan plan continue failed:",
        error instanceof Error ? error.message : error,
      );
    });

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: { runId: input.runId, resumed: true, orphanContinued: true },
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
  if (session.mustChangePassword) return passwordChangeRequiredResponse();
  logCtx.setUser({
    userId: session.userId,
    tenantId: session.tenantId,
  });
  logCtx.setMode("deep_research");

  let body: {
    runId?: unknown;
    answers?: unknown;
    skip?: unknown;
    chatReply?: unknown;
    planAction?: unknown;
    planPatch?: unknown;
    model?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    logCtx.markNoop();
    return NextResponse.json(
      { error: { code: "40001", message: "invalid json body" } },
      { status: 400 },
    );
  }

  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!runId) {
    logCtx.markNoop();
    return NextResponse.json(
      { error: { code: "40001", message: "runId required" } },
      { status: 400 },
    );
  }
  logCtx.setRun(runId);

  const answers: Record<string, string> = {};
  const chatReply = typeof body.chatReply === "string" ? body.chatReply.trim() : "";
  if (chatReply) {
    answers[CHAT_CLARIFY_ANSWER_KEY] = chatReply.slice(0, MAX_GATE_ANSWER_CHARS);
  } else if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
    for (const [key, value] of Object.entries(body.answers as Record<string, unknown>)) {
      const normalizedKey = key.trim().slice(0, 128);
      if (normalizedKey && typeof value === "string" && value.trim()) {
        answers[normalizedKey] = value.trim().slice(0, MAX_GATE_ANSWER_CHARS);
      }
    }
  }
  if (
    typeof body.planAction === "string" &&
    PLAN_ACTIONS.has(body.planAction)
  ) {
    answers[PLAN_GATE_ACTION_KEY] = body.planAction;
  }
  if (typeof body.planPatch === "string" && body.planPatch.trim()) {
    answers[PLAN_GATE_PATCH_KEY] = body.planPatch.trim().slice(0, MAX_PLAN_PATCH_CHARS);
  }
  const skip =
    body.skip === true ||
    (Object.keys(answers).length === 0 && body.planAction === undefined);

  let run;
  try {
    run = await defaultRunStore.get(session.tenantId, session.userId, runId);
  } catch (error) {
    console.warn("[deep-research] clarify run lookup failed:", error);
    return NextResponse.json(
      { error: { code: "50000", message: "clarify resume failed" } },
      { status: 500 },
    );
  }
  const initialPlanGate =
    run?.status === "awaiting_clarify" && orphanGateKind(run.events) === "plan";
  const hadLiveWaiter = hasLiveClarifyWaiter(runId);

  let outcome: "resumed" | "already_continued" | "not_found";
  try {
    outcome = await defaultRunStore.resolveClarification({
      tenantId: session.tenantId,
      userId: session.userId,
      runId,
      payload: { answers, skip },
    });
  } catch (error) {
    // A storage failure must not masquerade as "already continued" — the run is
    // still waiting and the client needs to be able to retry.
    console.warn("[deep-research] clarify resume failed:", error);
    return NextResponse.json(
      { error: { code: "50000", message: "clarify resume failed" } },
      { status: 500 },
    );
  }

  if (outcome === "not_found") {
    // Same 404 for missing, cross-tenant and cross-user runs so a valid runId
    // cannot be probed from another account.
    return NextResponse.json(
      { error: { code: "40401", message: "run not found" } },
      { status: 404 },
    );
  }

  if (outcome === "already_continued") {
    logCtx.markNoop();
    return alreadyContinued(runId);
  }

  notifyClarifyResume(runId);
  if (!initialPlanGate || hadLiveWaiter) {
    return NextResponse.json({ code: "00000", message: "ok", data: { runId, resumed: true } });
  }

  // A waiter in another instance polls once per second. Only take over if the
  // explicit user action remains unclaimed after a full poll interval.
  await new Promise((resolve) => setTimeout(resolve, ORPHAN_HANDOFF_MS));
  run = await defaultRunStore.get(session.tenantId, session.userId, runId);
  if (!run || run.phase !== "plan" || orphanGateKind(run.events) !== "plan") {
    return NextResponse.json({ code: "00000", message: "ok", data: { runId, resumed: true } });
  }
  if (!(await defaultRunStore.claimPlanGateResume(runId))) {
    logCtx.markNoop();
    return alreadyContinued(runId);
  }

  return continueClaimedPlanGate({
    run,
    runId,
    answers,
    chatReply,
    skip,
    model: body.model,
    session,
    accessToken,
    traceId: run.traceId?.trim() || logCtx.traceId,
  });
  }, request);
}
