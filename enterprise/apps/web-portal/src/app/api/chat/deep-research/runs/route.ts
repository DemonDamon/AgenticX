import { NextResponse } from "next/server";
import { getSessionFromCookies } from "../../../../../lib/session";
import { createRunStore } from "../../../../../lib/deep-research/run-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
  const store = createRunStore();
  const rows = await store.listActive(session.tenantId, session.userId, sessionId);

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      runs: rows.map((row) => ({
        runId: row.runId,
        sessionId: row.sessionId,
        status: row.status,
        phase: row.phase,
        topic: row.topic,
        updatedAt: row.updatedAt,
      })),
    },
  });
}
