import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../lib/session";
import { defaultRunStore } from "../../../../../lib/deep-research/run-store";
import {
  CHAT_CLARIFY_ANSWER_KEY,
  MAX_GATE_ANSWER_CHARS,
  MAX_PLAN_PATCH_CHARS,
  PLAN_GATE_ACTION_KEY,
  PLAN_GATE_PATCH_KEY,
  notifyClarifyResume,
} from "../../../../../lib/deep-research/run-wait";
import { withRequestLog } from "../../../../../lib/observability/with-request-log";

export async function POST(request: Request) {
  return withRequestLog("deep_research.resume", async (logCtx) => {
  const session = await getSessionFromCookies();
  if (session?.mustChangePassword) {
    return passwordChangeRequiredResponse();
  }
  if (!session) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 },
    );
  }
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
    (body.planAction === "approve" || body.planAction === "edit" || body.planAction === "skip")
  ) {
    answers[PLAN_GATE_ACTION_KEY] = body.planAction;
  }
  if (typeof body.planPatch === "string" && body.planPatch.trim()) {
    answers[PLAN_GATE_PATCH_KEY] = body.planPatch.trim().slice(0, MAX_PLAN_PATCH_CHARS);
  }
  const skip =
    body.skip === true ||
    (Object.keys(answers).length === 0 && body.planAction === undefined);

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
    // Idempotent: a timeout or an earlier submission already continued the run.
    // Returning 404 here made the clarify card dump raw JSON while research ran.
    logCtx.markNoop();
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { runId, resumed: false, alreadyContinued: true },
    });
  }

  notifyClarifyResume(runId);
  return NextResponse.json({ code: "00000", message: "ok", data: { runId, resumed: true } });
  }, request);
}
