import { NextResponse } from "next/server";
import { getSessionFromCookies, passwordChangeRequiredResponse } from "../../../../../lib/session";
import { defaultRunStore } from "../../../../../lib/deep-research/run-store";
import { notifyClarifyResume } from "../../../../../lib/deep-research/run-wait";

export async function POST(request: Request) {
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

  let body: { runId?: unknown; answers?: unknown; skip?: unknown };
  try {
    body = (await request.json()) as {
      runId?: unknown;
      answers?: unknown;
      skip?: unknown;
    };
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
  if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
    for (const [key, value] of Object.entries(body.answers as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) answers[key] = value.trim();
    }
  }
  const skip = body.skip === true || Object.keys(answers).length === 0;

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
    return NextResponse.json({
      code: "00000",
      message: "ok",
      data: { runId, resumed: false, alreadyContinued: true },
    });
  }

  notifyClarifyResume(runId);
  return NextResponse.json({ code: "00000", message: "ok", data: { runId, resumed: true } });
}
