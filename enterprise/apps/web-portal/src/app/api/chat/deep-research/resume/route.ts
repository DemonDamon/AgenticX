import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../../lib/session";
import { resolveClarifyResume } from "../../../../../lib/deep-research/run-wait";

export async function POST(request: Request) {
  const session = await getSessionFromCookies();
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
  const ok = resolveClarifyResume(runId, { answers, skip });
  if (!ok) {
    return NextResponse.json(
      { error: { code: "40401", message: "no pending clarify for runId" } },
      { status: 404 },
    );
  }

  return NextResponse.json({ code: "00000", message: "ok", data: { runId, resumed: true } });
}
