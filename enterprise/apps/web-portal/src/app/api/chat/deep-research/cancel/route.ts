import { NextResponse } from "next/server";
import {
  getSessionAuthFromCookies,
  passwordChangeRequiredResponse,
} from "../../../../../lib/session";
import { defaultRunStore } from "../../../../../lib/deep-research/run-store";
import { withRequestLog } from "../../../../../lib/observability/with-request-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withRequestLog("deep_research.cancel", async (logCtx) => {
    const auth = await getSessionAuthFromCookies();
    if (!auth) return NextResponse.json({ error: { message: "请重新登录。" } }, { status: 401 });
    if (auth.session.mustChangePassword) return passwordChangeRequiredResponse();
    let runId = "";
    try {
      const body = await request.json();
      runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    } catch {
      return NextResponse.json({ error: { message: "请求格式错误。" } }, { status: 400 });
    }
    if (!runId || runId.length > 128) {
      return NextResponse.json({ error: { message: "缺少有效的研究任务 ID。" } }, { status: 400 });
    }
    logCtx.setUser({ tenantId: auth.session.tenantId, userId: auth.session.userId });
    logCtx.setMode("deep_research");
    logCtx.setRun(runId);
    const run = await defaultRunStore.get(auth.session.tenantId, auth.session.userId, runId);
    if (!run) return NextResponse.json({ error: { message: "研究任务不存在。" } }, { status: 404 });
    await defaultRunStore.finish(runId, "cancelled");
    const result = await defaultRunStore.get(auth.session.tenantId, auth.session.userId, runId);
    if (!result) return NextResponse.json({ error: { message: "终止未确认，请重试。" } }, { status: 503 });
    return NextResponse.json({
      code: "00000",
      data: { runId, status: result.status },
    });
  }, request);
}
